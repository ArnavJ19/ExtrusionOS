"use client";

// Scrap requests from the foundry (scrap type, alloy, kilograms, needed-by date) and the company's list of scrap types.
// A request is closed by receiving enough scrap against it, or by its requester or the factory manager with a reason.
import { useState } from "react";
import Link from "next/link";
import { ALLOY_OPTIONS, REQUEST_STATUS, type ScrapType } from "@/lib/foundry/scrap-receiving";
import { fmtDay, fmtWhen } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../../order-to-cash/ui";
import { kgText, labelClass, type Note } from "./shared";

type RequestRow = { id: string; request_number: string; scrap_type: string; alloy: string; quantity_kg: number; required_by: string | null; purpose: string | null; status: string;
  requested_by: string; requested_at: string; close_reason: string | null; received_kg: number; can_close: boolean };
const TONE: Record<string, string> = { open: "open", fulfilled: "approved", cancelled: "cancelled" };

export function ScrapTypeSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const types = useApRead<{ types: ScrapType[] }>("ap_scrap_receipt", "types", {}, []);
  const [adding, setAdding] = useState<string | null>(null); const [message, setMessage] = useState<Note>(null);
  async function add() {
    if (!adding || adding.trim().length < 3) return;
    const out = await apWrite<ScrapType>("ap_scrap_receipt", "add_type", { name: adding.trim() }, setMessage);
    if (out) { onChange(out.id); setAdding(null); types.reload(); }
  }
  return <div className="space-y-1">
    <div className="flex gap-2">
      <select className={inputClass} aria-label="Scrap type" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose the scrap type…</option>
        {(types.data?.types ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {adding === null ? <button type="button" className={`${secondaryClass} shrink-0`} onClick={() => setAdding("")}>New scrap type</button> : null}
    </div>
    {adding !== null ? <div className="flex gap-2"><input className={inputClass} aria-label="New scrap type name" value={adding} maxLength={80} onChange={(e) => setAdding(e.target.value)} placeholder="Name of the scrap type" />
      <button type="button" className={buttonClass} disabled={adding.trim().length < 3} onClick={add}>Add</button><button type="button" className={secondaryClass} onClick={() => setAdding(null)}>Cancel</button></div> : null}
    {types.error ? <Failure text={types.error} /> : null}
    <Message value={message} />
  </div>;
}

export function RequestForm({ onCreated }: { onCreated: () => void }) {
  const [typeId, setTypeId] = useState(""); const [alloy, setAlloy] = useState("6063"); const [kg, setKg] = useState(""); const [by, setBy] = useState(""); const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<Note>(null);
  async function submit() {
    setBusy(true);
    const out = await apWrite<{ request_number: string }>("ap_scrap_receipt", "request", { scrap_type_id: typeId, alloy: alloy.trim(), quantity_kg: Number(kg),
      ...(by ? { required_by: by } : {}), ...(purpose.trim().length >= 3 ? { purpose: purpose.trim() } : {}) }, setMessage);
    setBusy(false);
    if (out) { setMessage({ tone: "ok", text: `${out.request_number} sent. Accounts and the factory manager have been told.` }); setKg(""); setBy(""); setPurpose(""); onCreated(); }
  }
  return <Section title="Request scrap" description="Tell accounts and the factory manager what the furnace needs. No prices here.">
    <div className="grid gap-2 sm:grid-cols-2">
      <div><span className={labelClass}>Scrap type</span><ScrapTypeSelect value={typeId} onChange={setTypeId} /></div>
      <label className={labelClass}>Alloy<input className={inputClass} list="request-alloys" value={alloy} maxLength={20} onChange={(e) => setAlloy(e.target.value)} />
        <datalist id="request-alloys">{ALLOY_OPTIONS.map((a) => <option key={a} value={a} />)}</datalist></label>
      <label className={labelClass}>Quantity kg<input className={inputClass} inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} /></label>
      <label className={labelClass}>Needed by (optional)<input type="date" className={inputClass} value={by} onChange={(e) => setBy(e.target.value)} /></label>
    </div>
    <label className={labelClass}>Purpose (optional)<input className={inputClass} value={purpose} maxLength={300} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. 6063 charge for furnace 2 next week" /></label>
    <button type="button" className={buttonClass} disabled={busy || !typeId || alloy.trim().length < 2 || !(Number(kg) >= 1)} onClick={submit}>{busy ? "Sending…" : "Send request"}</button>
    <Message value={message} />
  </Section>;
}

export function RequestList({ canReceive, refreshKey }: { canReceive: boolean; refreshKey: number }) {
  const [status, setStatus] = useState<"open" | "fulfilled" | "cancelled" | "all">("open"); const [page, setPage] = useState(1);
  const list = useApRead<{ rows: RequestRow[]; total: number }>("ap_scrap_receipt", "requests", { page, status }, [page, status, refreshKey]);
  const [closing, setClosing] = useState<string | null>(null); const [reason, setReason] = useState(""); const [message, setMessage] = useState<Note>(null);
  async function close(id: string) {
    const out = await apWrite("ap_scrap_receipt", "cancel_request", { id, reason: reason.trim() }, setMessage, "Request closed.");
    if (out) { setClosing(null); setReason(""); list.reload(); }
  }
  return <Section title="Scrap requests" description="Ten per page. A request is fulfilled once enough scrap is received against it.">
    <div className="flex flex-wrap gap-1" role="tablist" aria-label="Request status">{(["open", "fulfilled", "cancelled", "all"] as const).map((key) => <button key={key} type="button" role="tab" aria-selected={status === key}
      className={`min-h-9 rounded-full border px-3 text-xs font-bold ${status === key ? "border-neutral-950 bg-neutral-950 text-white" : "bg-white"}`} onClick={() => { setStatus(key); setPage(1); }}>{key === "all" ? "All" : REQUEST_STATUS[key]}</button>)}</div>
    <Message value={message} />
    {list.loading && !list.data ? <Loading what="requests" /> : list.error ? <Failure text={list.error} /> : !list.data?.rows.length ? <Empty>No requests here.</Empty> : <>
      <ul className="space-y-2">{list.data.rows.map((row) => {
        const percent = Math.min(100, Math.round((Number(row.received_kg) / Number(row.quantity_kg)) * 100));
        return <li key={row.id} className="space-y-2 rounded-xl border p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className="font-bold">{row.request_number} · {row.scrap_type} · {row.alloy}</p>
              <p className="text-xs text-neutral-500">{row.requested_by} · {fmtWhen(row.requested_at)}{row.required_by ? ` · needed by ${fmtDay(row.required_by)}` : ""}</p>
              {row.purpose ? <p className="text-sm">{row.purpose}</p> : null}{row.close_reason ? <p className="text-sm text-neutral-600">Closed: {row.close_reason}</p> : null}</div>
            <Pill value={TONE[row.status] ?? "unknown"} label={REQUEST_STATUS[row.status] ?? row.status} />
          </div>
          <div aria-label={`Received ${percent}%`} className="h-2 overflow-hidden rounded-full bg-neutral-100"><div className="h-full bg-emerald-600" style={{ width: `${percent}%` }} /></div>
          <p className="text-sm">Received {kgText(row.received_kg)} of {kgText(row.quantity_kg)}</p>
          {row.status === "open" ? <div className="flex flex-wrap gap-2">
            {canReceive ? <Link className={`${buttonClass} inline-flex items-center`} href={`/foundry/scrap/receive?request=${row.id}`}>Start receiving against this</Link> : null}
            {row.can_close ? closing === row.id ? <div className="flex w-full flex-wrap gap-2"><input className={inputClass} aria-label="Reason for closing" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Reason (at least 10 characters)" />
              <button type="button" className={secondaryClass} disabled={reason.trim().length < 10} onClick={() => close(row.id)}>Close request</button></div>
              : <button type="button" className={secondaryClass} onClick={() => { setClosing(row.id); setReason(""); }}>Close…</button> : null}
          </div> : null}
        </li>;
      })}</ul>
      <Pager page={page} total={list.data.total} onPage={setPage} />
    </>}
  </Section>;
}

export function RequestsWorkspace({ canRequest }: { canRequest: boolean }) {
  const [refresh, setRefresh] = useState(0);
  return <div className="space-y-4">
    {canRequest ? <RequestForm onCreated={() => setRefresh((n) => n + 1)} /> : null}
    <RequestList canReceive={canRequest} refreshKey={refresh} />
  </div>;
}

export function ScrapTypesManager({ canManage, canAdd }: { canManage: boolean; canAdd: boolean }) {
  const types = useApRead<{ types: ScrapType[] }>("ap_scrap_receipt", "types", { include_inactive: true }, []);
  const [name, setName] = useState(""); const [message, setMessage] = useState<Note>(null);
  async function add() {
    const out = await apWrite<ScrapType>("ap_scrap_receipt", "add_type", { name: name.trim() }, setMessage);
    if (out) { setName(""); setMessage({ tone: "ok", text: `“${out.name}” is available on requests and receipts.` }); types.reload(); }
  }
  async function toggle(type: ScrapType) {
    const out = await apWrite("ap_scrap_receipt", "set_type_active", { id: type.id, is_active: !type.is_active }, setMessage);
    if (out) types.reload();
  }
  return <Section title="Scrap types" description="The choices on scrap requests and receipts. A type switched off stays on past records.">
    {canAdd ? <div className="flex gap-2"><input className={inputClass} aria-label="New scrap type name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="New scrap type, e.g. Imported extrusion (Tread)" />
      <button type="button" className={buttonClass} disabled={name.trim().length < 3} onClick={add}>Add scrap type</button></div> : null}
    <Message value={message} />
    {types.loading && !types.data ? <Loading what="scrap types" /> : types.error ? <Failure text={types.error} /> : <ul className="divide-y rounded-xl border">
      {(types.data?.types ?? []).map((t) => <li key={t.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
        <span className={t.is_active ? "font-semibold" : "text-neutral-400 line-through"}>{t.name}</span>
        {canManage ? <button type="button" className="text-xs font-bold underline" onClick={() => toggle(t)}>{t.is_active ? "Switch off" : "Switch on"}</button> : t.is_active ? null : <span className="text-xs text-neutral-500">Off</span>}
      </li>)}</ul>}
  </Section>;
}
