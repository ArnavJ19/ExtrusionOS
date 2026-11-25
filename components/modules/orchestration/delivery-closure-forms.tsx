"use client";

// Orchestration Phase 7: forms for shipment updates, delivery receipts, the complaint workflow, receivable disputes and
// write-offs, and final closure. The database checks every rule (who may act, quantities within the dispatch, the
// second-person rules, the closure obligations); these forms only collect the request and show the database's answer.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { complaintAction, deliveryTrackingAction, orderClosureAction, receivableFollowupAction } from "@/lib/actions/orchestration";
import { formatWeight } from "@/lib/utils/format";
import { COMPLAINT_CATEGORIES, COMPLAINT_CATEGORY_LABELS, QUALITY_CATEGORIES, SEVERITIES, SEVERITY_DUE_DAYS, complaintCandidatesSchema, complaintDetailSchema,
  receiptDiscrepancy, type ComplaintCandidates } from "@/lib/workflow/delivery-closure";

const input = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
type Message = { ok: boolean; text: string } | null;
const Note = ({ message }: { message: Message }) => message
  ? <p role={message.ok ? "status" : "alert"} className={`text-sm font-semibold [overflow-wrap:anywhere] ${message.ok ? "text-emerald-800" : "text-red-800"}`}>{message.text}</p> : null;

const ACTIONS = { delivery: deliveryTrackingAction, complaint: complaintAction, receivable: receivableFollowupAction, closure: orderClosureAction } as const;
export type CommandArea = keyof typeof ACTIONS;

export type Field = {
  name: string; label: string; type: "text" | "textarea" | "number" | "select" | "datetime" | "date" | "checkbox";
  options?: { value: string; label: string }[]; required?: boolean; min?: number; max?: number; step?: string; help?: string; defaultValue?: string; minLength?: number; maxLength?: number;
};

/** Converts the collected strings to the request: numbers, booleans and ISO times; empty optional fields are left out. */
export function buildPayload(fields: Field[], values: Record<string, string | boolean>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.name];
    if (f.type === "checkbox") { if (v === true) out[f.name] = true; continue; }
    const s = typeof v === "string" ? v.trim() : "";
    if (!s) continue;
    if (f.type === "number") out[f.name] = Number(s);
    else if (f.type === "datetime") out[f.name] = new Date(s).toISOString();
    else out[f.name] = s;
  }
  return out;
}

/**
 * One command as a form: the fixed part of the request (identity, record) plus the fields the person fills. With
 * `withId`, one request identity is kept per attempt so a retry after an unconfirmed send replays instead of duplicating.
 */
export function CommandForm({ area, command, fixed = {}, fields, title, help, submitLabel, withId = false, collapsed = false, danger = false, redirectTo, done }: {
  area: CommandArea; command: string; fixed?: Record<string, unknown>; fields: Field[]; title: string; help?: string; submitLabel: string; withId?: boolean;
  collapsed?: boolean; danger?: boolean; redirectTo?: (data: unknown) => string | null; done?: string;
}) {
  const router = useRouter();
  const requestId = useRef<string>(crypto.randomUUID());
  const [open, setOpen] = useState(!collapsed);
  const [values, setValues] = useState<Record<string, string | boolean>>(() => Object.fromEntries(fields.map(f => [f.name, f.type === "checkbox" ? f.defaultValue === "true" : f.defaultValue ?? ""])));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const set = (name: string, value: string | boolean) => { setValues(v => ({ ...v, [name]: value })); requestId.current = crypto.randomUUID(); };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMessage(null);
    const result = await ACTIONS[area]({ command, ...fixed, ...(withId ? { id: requestId.current } : {}), ...buildPayload(fields, values) });
    setBusy(false);
    if (!result.success) { setMessage({ ok: false, text: result.error }); return; }
    requestId.current = crypto.randomUUID();
    const next = redirectTo?.(result.data);
    if (next) { router.push(next); return; }
    // The form stays open with its confirmation; the fields are cleared so a second click is a deliberate new entry.
    setValues(Object.fromEntries(fields.map(f => [f.name, f.type === "checkbox" ? f.defaultValue === "true" : f.defaultValue ?? ""])));
    setMessage({ ok: true, text: done ?? "Recorded." });
    router.refresh();
  }
  if (!open) return <button type="button" className={`min-h-11 rounded-xl border px-4 text-sm font-bold ${danger ? "border-red-300 bg-white text-red-900" : "border-slate-300 bg-white"}`} onClick={() => setOpen(true)}>{title}</button>;
  return (
    <form className="space-y-3 rounded-2xl border border-slate-300 bg-white p-4" onSubmit={submit}>
      <h3 className="text-base font-bold">{title}</h3>
      {help ? <p className="text-sm text-slate-600">{help}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map(f => {
          const v = values[f.name];
          const common = { id: `${command}-${f.name}`, required: f.required, disabled: busy };
          if (f.type === "checkbox") return <label key={f.name} className="flex min-h-11 items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" className="mt-1 h-5 w-5" checked={v === true} onChange={e => set(f.name, e.target.checked)} {...common} /><span>{f.label}{f.help ? <span className="block text-xs text-slate-600">{f.help}</span> : null}</span></label>;
          return (
            <label key={f.name} className={`text-sm font-semibold ${f.type === "textarea" ? "sm:col-span-2" : ""}`}>{f.label}{f.required ? "" : " (optional)"}
              {f.type === "textarea" ? <textarea className={input} rows={3} minLength={f.minLength} maxLength={f.maxLength ?? 1000} value={String(v ?? "")} onChange={e => set(f.name, e.target.value)} {...common} />
                : f.type === "select" ? <select className={input} value={String(v ?? "")} onChange={e => set(f.name, e.target.value)} {...common}>
                  <option value="">Choose…</option>{(f.options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                : <input className={input} type={f.type === "datetime" ? "datetime-local" : f.type} min={f.min} max={f.max} step={f.step} minLength={f.minLength} maxLength={f.maxLength}
                    value={String(v ?? "")} onChange={e => set(f.name, e.target.value)} {...common} />}
              {f.help ? <span className="mt-1 block text-xs font-normal text-slate-600">{f.help}</span> : null}
            </label>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} variant={danger ? "danger" : "primary"}>{submitLabel}</Button>
        {collapsed ? <button type="button" className="min-h-11 rounded-xl border px-4 text-sm font-bold" onClick={() => setOpen(false)}>Cancel</button> : null}
      </div>
      <Note message={message} />
    </form>
  );
}

/** Delivery receipt with a live preview of whether it records a discrepancy (the database decides the same way). */
export function DeliveryReceiptForm({ dispatchId, bundles, netKg, toleranceKg = 1, correcting }: { dispatchId: string; bundles: number; netKg: number; toleranceKg?: number; correcting: boolean }) {
  const router = useRouter();
  const requestId = useRef<string>(crypto.randomUUID());
  // The delivery time starts empty; the person enters it from the proof of delivery.
  const [v, setV] = useState({ delivered_at: "", receiving_company: "", receiver_name: "", receiver_phone: "", received_bundles: String(bundles), received_kg: String(netKg),
    shortage_kg: "", damaged_kg: "", acknowledgement: "", note: "", correction_reason: "", accept_all: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const set = (k: keyof typeof v, value: string | boolean) => { setV(x => ({ ...x, [k]: value })); requestId.current = crypto.randomUUID(); };
  const preview = receiptDiscrepancy({ dispatched_kg: netKg, dispatched_bundles: bundles, received_kg: Number(v.received_kg || 0), received_bundles: Number(v.received_bundles || 0),
    shortage_kg: Number(v.shortage_kg || 0), damaged_kg: Number(v.damaged_kg || 0) }, toleranceKg);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMessage(null);
    const result = await deliveryTrackingAction({ command: "receipt.record", id: requestId.current, dispatch_id: dispatchId, delivered_at: new Date(v.delivered_at).toISOString(),
      receiving_company: v.receiving_company.trim(), receiver_name: v.receiver_name.trim(), ...(v.receiver_phone.trim() ? { receiver_phone: v.receiver_phone.trim() } : {}),
      received_bundles: Number(v.received_bundles), received_kg: Number(v.received_kg), ...(v.shortage_kg ? { shortage_kg: Number(v.shortage_kg) } : {}),
      ...(v.damaged_kg ? { damaged_kg: Number(v.damaged_kg) } : {}), acknowledgement: v.acknowledgement, ...(v.note.trim() ? { note: v.note.trim() } : {}),
      ...(v.accept_all && !preview.open ? { accept_all: true } : {}), ...(correcting ? { correction_reason: v.correction_reason.trim() } : {}) });
    setBusy(false);
    if (!result.success) { setMessage({ ok: false, text: result.error }); return; }
    requestId.current = crypto.randomUUID();
    setMessage({ ok: true, text: preview.open ? "Receipt recorded. Sales has a discrepancy task for the affected bundles." : "Receipt recorded." });
    router.refresh();
  }
  return (
    <form className="space-y-3 rounded-2xl border border-slate-300 bg-white p-4" onSubmit={submit}>
      <h3 className="text-base font-bold">{correcting ? "Correct the delivery receipt" : "Record the delivery receipt"}</h3>
      <p className="text-sm text-slate-600">From the proof of delivery: who received the material, what arrived, and any shortage or damage. Dispatched: {bundles} bundle(s), {formatWeight(netKg)} net.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">Delivered at<input type="datetime-local" required className={input} value={v.delivered_at} onChange={e => set("delivered_at", e.target.value)} /></label>
        <label className="text-sm font-semibold">Acknowledged by
          <select required className={input} value={v.acknowledgement} onChange={e => set("acknowledgement", e.target.value)}><option value="">Choose…</option>
            <option value="signed_challan">Signed delivery challan</option><option value="stamped_lr">Stamped LR copy</option><option value="signed_invoice">Signed invoice copy</option>
            <option value="email">Email</option><option value="whatsapp">WhatsApp message</option><option value="photo">Photo of the unloaded material</option><option value="phone_call">Phone call</option></select></label>
        <label className="text-sm font-semibold">Receiving company<input required minLength={2} maxLength={160} className={input} value={v.receiving_company} onChange={e => set("receiving_company", e.target.value)} /></label>
        <label className="text-sm font-semibold">Received by<input required minLength={2} maxLength={120} className={input} value={v.receiver_name} onChange={e => set("receiver_name", e.target.value)} /></label>
        <label className="text-sm font-semibold">Receiver phone (optional)<input inputMode="tel" maxLength={20} className={input} value={v.receiver_phone} onChange={e => set("receiver_phone", e.target.value)} /></label>
        <label className="text-sm font-semibold">Bundles received<input type="number" required min={0} max={bundles} className={input} value={v.received_bundles} onChange={e => set("received_bundles", e.target.value)} /></label>
        <label className="text-sm font-semibold">Kilograms received<input type="number" required min={0} step="0.001" className={input} value={v.received_kg} onChange={e => set("received_kg", e.target.value)} /></label>
        <label className="text-sm font-semibold">Shortage reported, kg (optional)<input type="number" min={0} step="0.001" className={input} value={v.shortage_kg} onChange={e => set("shortage_kg", e.target.value)} /></label>
        <label className="text-sm font-semibold">Damaged, kg (optional)<input type="number" min={0} step="0.001" className={input} value={v.damaged_kg} onChange={e => set("damaged_kg", e.target.value)} /></label>
        <label className="text-sm font-semibold sm:col-span-2">Note (optional)<textarea maxLength={1000} className={input} value={v.note} onChange={e => set("note", e.target.value)} /></label>
        {correcting ? <label className="text-sm font-semibold sm:col-span-2">Why the earlier receipt is corrected<textarea required minLength={10} maxLength={500} className={input} value={v.correction_reason} onChange={e => set("correction_reason", e.target.value)} /></label> : null}
      </div>
      {preview.open ? <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">This receipt records a discrepancy: {formatWeight(preview.discrepancyKg)} not received in good condition{preview.missingBundles > 0 ? `, ${preview.missingBundles} bundle(s) missing` : ""}. Sales will agree each affected bundle with the customer.</p>
        : <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-5 w-5" checked={v.accept_all} onChange={e => set("accept_all", e.target.checked)} />
          <span><b>The customer accepted every bundle.</b> Records acceptance of each bundle that has no disposition yet, by the person named above. Leave it off if the customer is still inspecting.</span></label>}
      <Button disabled={busy}>{correcting ? "Record the corrected receipt" : "Record the receipt"}</Button>
      <Note message={message} />
    </form>
  );
}

/** Logs a complaint: find the order, then optionally its dispatch and the affected bundles. */
export function ComplaintLogForm({ initialOrders, initialOrderId }: { initialOrders: NonNullable<ComplaintCandidates["orders"]>; initialOrderId?: string }) {
  const router = useRouter();
  const requestId = useRef<string>(crypto.randomUUID());
  const [orders, setOrders] = useState(initialOrders);
  const [search, setSearch] = useState("");
  const [orderId, setOrderId] = useState("");
  const [detail, setDetail] = useState<ComplaintCandidates | null>(null);
  const [dispatchId, setDispatchId] = useState("");
  const [items, setItems] = useState<Record<string, string>>({});
  const [v, setV] = useState({ category: "", severity: "", description: "", customer_reference: "", reported_on: "", suspected_kg: "", evidence: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const fresh = () => { requestId.current = crypto.randomUUID(); };
  async function find(e: React.FormEvent) {
    e.preventDefault();
    const r = await complaintAction({ command: "candidates", ...(search.trim() ? { search: search.trim() } : {}) });
    const parsed = r.success ? complaintCandidatesSchema.safeParse(r.data) : null;
    if (parsed?.success && parsed.data.orders) setOrders(parsed.data.orders); else setMessage({ ok: false, text: r.success ? "The orders could not be read." : r.error });
  }
  async function choose(id: string) {
    setOrderId(id); setDispatchId(""); setItems({}); setDetail(null); fresh();
    if (!id) return;
    const r = await complaintAction({ command: "candidates", order_id: id });
    const parsed = r.success ? complaintCandidatesSchema.safeParse(r.data) : null;
    if (parsed?.success) setDetail(parsed.data); else setMessage({ ok: false, text: r.success ? "The dispatches could not be read." : r.error });
  }
  // An order passed from a shipment or the lifecycle is chosen at once.
  useEffect(() => { if (initialOrderId && initialOrders.some(o => o.id === initialOrderId)) void choose(initialOrderId); }, [initialOrderId]);
  const lines = (detail?.dispatches ?? []).filter(d => !dispatchId || d.id === dispatchId).flatMap(d => d.lines.map(l => ({ ...l, dispatch: d.dispatch_number })));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMessage(null);
    const chosen = Object.entries(items).map(([id, kg]) => ({ packing_list_item_id: id, ...(kg.trim() ? { affected_kg: Number(kg) } : {}) }));
    const r = await complaintAction({ command: "log", id: requestId.current, order_id: orderId, ...(dispatchId ? { dispatch_id: dispatchId } : {}), category: v.category, severity: v.severity,
      description: v.description.trim(), ...(v.customer_reference.trim() ? { customer_reference: v.customer_reference.trim() } : {}), ...(v.reported_on ? { reported_on: v.reported_on } : {}),
      ...(v.suspected_kg ? { suspected_kg: Number(v.suspected_kg) } : {}), ...(v.evidence.trim() ? { evidence: v.evidence.trim() } : {}), ...(chosen.length ? { items: chosen } : {}) });
    setBusy(false);
    if (!r.success) { setMessage({ ok: false, text: r.error }); return; }
    const parsed = complaintDetailSchema.safeParse(r.data);
    if (parsed.success) router.push(`/quality/complaints/${parsed.data.complaint.id}`); else router.push("/quality/complaints");
  }
  return (
    <div className="space-y-4">
      <form className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-end" onSubmit={find}>
        <label className="flex-1 text-sm font-semibold">Find the order (number or customer)<input type="search" maxLength={80} className={input} value={search} onChange={e => setSearch(e.target.value)} /></label>
        <Button variant="secondary">Search</Button>
      </form>
      <form className="space-y-3 rounded-2xl border border-slate-300 bg-white p-4" onSubmit={submit}>
        <label className="block text-sm font-semibold">Order
          <select required className={input} value={orderId} onChange={e => choose(e.target.value)}><option value="">Choose a dispatched order…</option>
            {orders.map(o => <option key={o.id} value={o.id}>{o.order_number} · {o.customer ?? "—"}</option>)}</select></label>
        {detail?.dispatches?.length ? <label className="block text-sm font-semibold">Dispatch (optional)
          <select className={input} value={dispatchId} onChange={e => { setDispatchId(e.target.value); setItems({}); fresh(); }}><option value="">Whole order</option>
            {detail.dispatches.map(d => <option key={d.id} value={d.id}>{d.dispatch_number ?? d.id.slice(0, 8)} · {d.delivery_status.replace(/_/g, " ")}</option>)}</select></label> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold">Category
            <select required className={input} value={v.category} onChange={e => { setV({ ...v, category: e.target.value }); fresh(); }}><option value="">Choose…</option>
              {COMPLAINT_CATEGORIES.map(c => <option key={c} value={c}>{COMPLAINT_CATEGORY_LABELS[c]}</option>)}</select>
            {QUALITY_CATEGORIES.has(v.category) ? <span className="mt-1 block text-xs font-normal text-slate-600">QA gets a draft NCR for this complaint.</span> : null}</label>
          <label className="text-sm font-semibold">Severity
            <select required className={input} value={v.severity} onChange={e => { setV({ ...v, severity: e.target.value }); fresh(); }}><option value="">Choose…</option>
              {SEVERITIES.map(s => <option key={s} value={s}>{s} — resolve within {SEVERITY_DUE_DAYS[s]} day(s)</option>)}</select>
            {v.severity === "high" || v.severity === "critical" ? <span className="mt-1 block text-xs font-normal text-slate-600">Management is told at once.</span> : null}</label>
          <label className="text-sm font-semibold sm:col-span-2">Reported defect<textarea required minLength={10} maxLength={1000} className={input} value={v.description} onChange={e => { setV({ ...v, description: e.target.value }); fresh(); }} /></label>
          <label className="text-sm font-semibold">Customer reference (optional)<input maxLength={120} className={input} value={v.customer_reference} onChange={e => { setV({ ...v, customer_reference: e.target.value }); fresh(); }} /></label>
          <label className="text-sm font-semibold">Reported on (optional, default today)<input type="date" className={input} value={v.reported_on} onChange={e => { setV({ ...v, reported_on: e.target.value }); fresh(); }} /></label>
          <label className="text-sm font-semibold">Suspected quantity, kg (optional)<input type="number" min={0.001} step="0.001" className={input} value={v.suspected_kg} onChange={e => { setV({ ...v, suspected_kg: e.target.value }); fresh(); }} /></label>
          <label className="text-sm font-semibold">Evidence (optional)<input maxLength={1000} className={input} placeholder="Photos, sample sent, inspection report…" value={v.evidence} onChange={e => { setV({ ...v, evidence: e.target.value }); fresh(); }} /></label>
        </div>
        {lines.length ? <fieldset className="space-y-2"><legend className="text-sm font-semibold">Affected bundles (optional; leave kg empty for the whole bundle)</legend>
          <ul className="divide-y rounded-xl border">{lines.map(l => <li key={l.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={l.id in items} onChange={e => { const next = { ...items }; if (e.target.checked) next[l.id] = ""; else delete next[l.id]; setItems(next); fresh(); }} />
              <span className="font-mono font-semibold">{l.bundle_number}</span></label>
            <span>{l.dispatch ?? "—"} · {l.pieces} pcs · {formatWeight(l.net_kg)}</span>
            {l.id in items ? <input type="number" min={0.001} step="0.001" aria-label={`Affected kg of ${l.bundle_number}`} className="w-32 rounded-xl border border-slate-300 px-2 py-1" value={items[l.id]} onChange={e => { setItems({ ...items, [l.id]: e.target.value }); fresh(); }} /> : null}
          </li>)}</ul></fieldset> : null}
        <Button disabled={busy || !orderId}>Log the complaint</Button>
        <Note message={message} />
      </form>
    </div>
  );
}
