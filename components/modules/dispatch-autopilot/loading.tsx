"use client";

// AP-018: load a vehicle by scanning bundles. The loader scans (USB scanner, camera or typed tag); the database checks
// each bundle against the order (held, another customer's, already on a vehicle, more than ordered) and the screen
// shows planned vs loaded per order line. Completing the load writes the dispatch through the existing dispatch writer
// from the scanned bundles, so no dispatch line is typed.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, CheckCircle2, ScanLine, Trash2, XCircle } from "lucide-react";
import { autopilotAction } from "@/lib/actions/autopilot";
import { completeLoadingAction } from "@/lib/actions/dispatch-autopilot";
import type { DuplicateMatch } from "@/lib/order-to-cash/duplicates";
import { SCAN_WARNING_LABELS } from "@/lib/dispatch-autopilot/commands";
import { fmtDay, fmtWhen } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";
import { FreightPanel } from "./freight";
import { UsualChoicesHint } from "../autopilot-usual/usual-choices";
import { OfflineQueuePanel, useOfflineQueue } from "../offline/offline-queue";

type Note = { tone: "ok" | "error"; text: string } | null;
type PlanLine = { line_id: string | null; profile: string; finish: string; ordered_pieces: number | null; ordered_kg: number | null; shipped_pieces: number; shipped_kg: number;
  loaded_bundles: number; loaded_pieces: number; loaded_kg: number; open_pieces: number | null; open_kg: number | null };
type Scan = { id: string; tag: string; outcome: "loaded" | "refused"; warnings: string[]; message: string; confirm_note: string | null; net_kg: number | null; pieces: number | null; scanned_at: string;
  scanned_by: string; removed_at: string | null; remove_reason: string | null };
export type Session = { id: string; order_id: string; order_number: string; customer: string; customer_id?: string; destination: string | null; status: string; vehicle_number: string | null; transporter_name: string | null;
  driver_name: string | null; driver_phone: string | null; lr_number: string | null; started_at: string; started_by: string; completed_at: string | null; dispatch_id: string | null; dispatch_number: string | null;
  cancel_reason: string | null; credit: string; expected_dispatch_date: string | null;
  plan?: { lines: PlanLine[]; unplanned: { bundles: number; pieces: number; kg: number } | null; totals: { bundles: number; pieces: number; kg: number; gross_kg: number } }; scans?: Scan[]; ready_here?: number };

const kg = (v: unknown) => (v === null || v === undefined ? "—" : `${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`);

export function LoadingSessionsClient() {
  const [status, setStatus] = useState<"open" | "completed" | "cancelled" | "all">("open");
  const [page, setPage] = useState(1); const [search, setSearch] = useState("");
  const list = useApRead<{ rows: Session[]; total_count: number }>("ap_dispatch", "sessions", { status, page, ...(search.trim() ? { search: search.trim() } : {}) }, []);
  return <Section title="Loading sessions" description="Start a load from the ready-to-ship list or from the order. One open session per order."
    actions={<Link href="/dispatches/ready" className={`${buttonClass} inline-flex items-center`}>Ready to ship</Link>}>
    <div className="flex flex-wrap gap-2">
      <input aria-label="Search loads" placeholder="Order, customer or vehicle" className={`${inputClass} max-w-xs`} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
      <select aria-label="Status" className={`${inputClass} w-36`} value={status} onChange={e => { setStatus(e.target.value as typeof status); setPage(1); }}>
        <option value="open">Open</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="all">All</option></select>
    </div>
    {list.loading && !list.data ? <Loading what="loading sessions" /> : list.error ? <Failure text={list.error} /> : !list.data?.rows.length ? <Empty>No {status === "all" ? "" : status} loading sessions.</Empty> :
      <ul className="space-y-2">{list.data.rows.map(s => <li key={s.id}><Link href={`/dispatches/loading/${s.id}`} className="block rounded-xl border border-neutral-200 p-3 text-sm hover:bg-neutral-50">
        <span className="flex flex-wrap items-center justify-between gap-2"><span className="font-bold">{s.order_number} · {s.customer}</span><Pill value={s.status === "open" ? "open" : s.status === "completed" ? "posted" : "cancelled"} label={s.status} /></span>
        <span className="block text-neutral-600">{s.vehicle_number ?? "Vehicle not recorded"}{s.transporter_name ? ` · ${s.transporter_name}` : ""} · started {fmtWhen(s.started_at)} by {s.started_by}{s.dispatch_number ? ` · ${s.dispatch_number}` : ""}</span>
      </Link></li>)}</ul>}
    {list.data ? <Pager page={page} total={list.data.total_count} onPage={setPage} /> : null}
  </Section>;
}

/** Starts (or reopens) the order's loading session and opens it. */
export function StartLoadingButton({ orderId, label = "Load a vehicle" }: { orderId: string; label?: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<Note>(null);
  return <span className="inline-flex flex-col gap-1">
    <button type="button" className={`${buttonClass} inline-flex items-center gap-2`} onClick={async () => {
      const s = await apWrite<Session>("ap_dispatch", "start", { order_id: orderId }, setMessage);
      if (s) router.push(`/dispatches/loading/${s.id}`);
    }}><ScanLine className="h-4 w-4" aria-hidden="true" />{label}</button>
    <Message value={message} />
  </span>;
}

export function OrderLoadingPanel({ orderId }: { orderId: string }) {
  const open = useApRead<Session | null>("ap_dispatch", "order_session", { order_id: orderId }, []);
  return <Section title="Loading" description="Scan this order's bundles into a vehicle; the dispatch is written from the scans.">
    {open.loading ? <Loading what="loading" /> : open.error ? <Failure text={open.error} /> : open.data
      ? <Link className={`${buttonClass} inline-flex items-center`} href={`/dispatches/loading/${open.data.id}`}>Continue loading {open.data.vehicle_number ?? ""}</Link>
      : <StartLoadingButton orderId={orderId} />}
  </Section>;
}

function CameraScan({ onScan, onClose }: { onScan: (text: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let scanner: { stop: () => Promise<void>; clear: () => void } | null = null; let done = false;
    void import("html5-qrcode").then(async ({ Html5Qrcode }) => {
      if (!ref.current || done) return;
      const instance = new Html5Qrcode(ref.current.id);
      scanner = instance as unknown as typeof scanner;
      await instance.start({ facingMode: "environment" }, { fps: 8, qrbox: 220 }, text => { if (!done) { done = true; onScan(text); } }, () => undefined);
    }).catch(() => setError("The camera is not available. Use the scanner or type the tag."));
    return () => { done = true; void scanner?.stop().catch(() => undefined); };
  }, [onScan]);
  return <div className="space-y-2 rounded-xl border border-neutral-200 p-3"><div id="loading-camera" ref={ref} className="mx-auto max-w-sm" />
    {error ? <Failure text={error} /> : null}<button type="button" className={secondaryClass} onClick={onClose}>Close camera</button></div>;
}

type ScanResult = { state: "loaded" | "refused" | "confirm" | "already_loaded"; warnings?: string[]; message: string; tag?: string; session?: Session };

export function LoadingStation({ sessionId, today, companyId = "local", userId = "local" }: { sessionId: string; today: string; companyId?: string; userId?: string }) {
  const router = useRouter();
  // AP-094: scans go through the offline queue, so a scan made with no signal is kept on the phone and sent once.
  const queue = useOfflineQueue(companyId, userId, () => { void reload(); });
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<ScanResult | null>(null);
  const [confirmNote, setConfirmNote] = useState("");
  const [camera, setCamera] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; reason: string } | null>(null);
  const [message, setMessage] = useState<Note>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null);
  const [edit, setEdit] = useState(false);
  const [header, setHeader] = useState({ vehicle_number: "", transporter_name: "", driver_name: "", driver_phone: "", lr_number: "" });
  const input = useRef<HTMLInputElement>(null);

  async function reload() {
    const result = await autopilotAction("ap_dispatch", "session", { id: sessionId });
    if (!result.success) { setError(result.error); return; }
    const s = result.data as Session; setSession(s); setError(null);
    setHeader({ vehicle_number: s.vehicle_number ?? "", transporter_name: s.transporter_name ?? "", driver_name: s.driver_name ?? "", driver_phone: s.driver_phone ?? "", lr_number: s.lr_number ?? "" });
  }
  useEffect(() => { void reload(); }, [sessionId]);

  async function scan(raw: string, confirm = false) {
    const value = raw.trim(); if (!value || busy) return;
    setBusy(true); setMessage(null);
    const outcome = await queue.submit({ rpc: "ap_dispatch", command: "scan", payload: { session_id: sessionId, tag: value, ...(confirm ? { confirm: true, note: confirmNote.trim() } : {}) }, label: `Loading scan ${value}` });
    setBusy(false);
    if (outcome.kind === "retry") { setLast({ state: "refused", message: `No connection. Scan ${value} is saved on this phone and will be sent.` }); setTag(""); input.current?.focus(); return; }
    if (outcome.kind === "conflict") { setLast({ state: "refused", message: outcome.message }); return; }
    const r = outcome.data as ScanResult;
    setLast({ ...r, tag: r.tag ?? value });
    if (r.session) setSession(r.session);
    if (r.state !== "confirm") { setTag(""); setConfirmNote(""); }
    input.current?.focus();
  }

  async function complete(confirmed = false) {
    setBusy(true); setMessage(null);
    const result = await completeLoadingAction({ sessionId, confirmDuplicate: confirmed ? { confirmed: true, note: "Confirmed at loading" } : undefined });
    setBusy(false);
    if (!result.success) { setMessage({ tone: "error", text: result.error }); setDuplicates(result.duplicates?.length ? result.duplicates : null); return; }
    setDuplicates(null); setMessage({ tone: "ok", text: "Dispatch written from the scanned bundles. The vehicle can go to the gate." });
    await reload(); router.refresh();
  }

  if (error) return <Failure text={error} />;
  if (!session) return <Loading what="the loading session" />;
  const open = session.status === "open";
  const plan = session.plan;
  const active = (session.scans ?? []).filter(s => s.outcome === "loaded" && !s.removed_at);
  const tone = last?.state === "loaded" ? "bg-emerald-600 text-white" : last?.state === "confirm" ? "bg-amber-400 text-neutral-950" : last?.state === "already_loaded" ? "bg-sky-600 text-white" : "bg-rose-600 text-white";
  return <div className="space-y-4"><OfflineQueuePanel queue={queue} what="scan(s)" />
    <Section title={`${session.order_number} · ${session.customer}`} description={`${session.destination ?? "Destination not recorded"} · due ${fmtDay(session.expected_dispatch_date)} · started by ${session.started_by} ${fmtWhen(session.started_at)}`}
      actions={<Pill value={open ? "open" : session.status === "completed" ? "posted" : "cancelled"} label={session.status} />}>
      {session.credit === "held" || session.credit === "rejected" || session.credit === "expired" ? <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">Credit {session.credit}: the dispatch will be refused until accounts approves credit for this order.</p> : null}
      {edit && open ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {(["vehicle_number", "transporter_name", "driver_name", "driver_phone", "lr_number"] as const).map(k => <label key={k} className="text-sm font-semibold">{k.replace("_", " ").replace("number", "no.").replace(/^./, c => c.toUpperCase())}
          <input className={`${inputClass} mt-1`} value={header[k]} onChange={e => setHeader(h => ({ ...h, [k]: e.target.value }))} /></label>)}
        <div className="flex gap-2 sm:col-span-2 lg:col-span-5"><button type="button" className={buttonClass} onClick={async () => {
          const payload = Object.fromEntries(Object.entries(header).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
          const s = await apWrite<Session>("ap_dispatch", "update", { id: sessionId, ...payload }, setMessage, "Vehicle details saved."); if (s) { setSession(s); setEdit(false); }
        }}>Save</button><button type="button" className={secondaryClass} onClick={() => setEdit(false)}>Cancel</button></div>
      </div> : <p className="text-sm">Vehicle <b>{session.vehicle_number ?? "not recorded"}</b>{session.transporter_name ? ` · ${session.transporter_name}` : ""}{session.driver_name ? ` · ${session.driver_name}` : ""}{session.driver_phone ? ` (${session.driver_phone})` : ""}{session.lr_number ? ` · LR ${session.lr_number}` : ""}
        {open ? <button type="button" className="ml-2 underline" onClick={() => setEdit(true)}>Change</button> : null}</p>}
      {open && !session.transporter_name && session.customer_id ? <UsualChoicesHint customerId={session.customer_id} surface="loading" fields={["transporter"]} current={{ transporter: session.transporter_name }}
        onUse={async (_field, value) => { const s = await apWrite<Session>("ap_dispatch", "update", { id: sessionId, ...Object.fromEntries(Object.entries({ ...header, transporter_name: value }).filter(([, v]) => v.trim())) }, setMessage, "Transporter set.");
          if (s) setSession(s); }} /> : null}
      {session.dispatch_id ? <p className="text-sm">Dispatch <Link className="font-bold underline" href={`/dispatches/${session.dispatch_id}`}>{session.dispatch_number}</Link> · <Link className="underline" href="/dispatches/gate">Gate</Link></p> : null}
      {session.cancel_reason ? <p className="text-sm text-neutral-600">Cancelled: {session.cancel_reason}</p> : null}
    </Section>

    {open ? <Section title="Scan bundles" description={`${session.ready_here ?? 0} measured bundle(s) of this order are not on a vehicle yet.`}>
      <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); void scan(tag); }}>
        <input ref={input} autoFocus aria-label="Bundle tag" placeholder="Scan or type the bundle tag" autoComplete="off" autoCapitalize="characters" enterKeyHint="go"
          className="min-h-14 min-w-0 flex-1 rounded-xl border-2 border-neutral-900 bg-white px-4 font-mono text-lg font-bold uppercase" value={tag} onChange={e => setTag(e.target.value)} />
        <button type="submit" disabled={busy || !tag.trim()} className={`${buttonClass} min-h-14`}>Load</button>
        <button type="button" aria-label="Scan with camera" className={`${secondaryClass} min-h-14`} onClick={() => setCamera(c => !c)}><Camera className="h-5 w-5" aria-hidden="true" /></button>
      </form>
      {camera ? <CameraScan onScan={text => { setCamera(false); setTag(text); void scan(text); }} onClose={() => setCamera(false)} /> : null}
      {last ? <div role={last.state === "loaded" ? "status" : "alert"} className={`rounded-2xl p-4 text-base font-bold ${tone}`}>
        <p className="flex items-center gap-2">{last.state === "loaded" ? <CheckCircle2 className="h-6 w-6" aria-hidden="true" /> : <XCircle className="h-6 w-6" aria-hidden="true" />}{last.message}</p>
        {last.warnings?.length ? <p className="mt-1 text-sm font-semibold">{last.warnings.map(w => SCAN_WARNING_LABELS[w] ?? w).join(" · ")}</p> : null}
        {last.state === "confirm" ? <div className="mt-2 flex flex-wrap gap-2"><input aria-label="Why load anyway" className={`${inputClass} flex-1 text-neutral-950`} value={confirmNote} onChange={e => setConfirmNote(e.target.value)} placeholder="Why it goes anyway" />
          <button type="button" className="min-h-11 rounded-xl bg-neutral-950 px-4 text-sm font-bold text-white" onClick={() => scan(last.tag ?? tag, true)}>Load anyway</button>
          <button type="button" className="min-h-11 rounded-xl bg-white px-4 text-sm font-bold text-neutral-950" onClick={() => { setLast(null); setTag(""); }}>Leave it</button></div> : null}
      </div> : null}
    </Section> : null}

    <Section title="Planned vs loaded" description={plan ? `${plan.totals.bundles} bundle(s) · ${plan.totals.pieces} pcs · ${kg(plan.totals.kg)} net · ${kg(plan.totals.gross_kg)} gross on the vehicle` : undefined}>
      {plan?.lines.length ? <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead><tr className="text-left text-neutral-500"><th className="py-1">Line</th><th>Ordered</th><th>Shipped before</th><th>On this vehicle</th><th>Still open</th></tr></thead>
        <tbody>{plan.lines.map((l, i) => <tr key={l.line_id ?? i} className="border-t border-neutral-100"><td className="py-2 font-semibold">{l.profile}<span className="block text-xs font-normal text-neutral-500">{l.finish}</span></td>
          <td>{l.ordered_pieces ?? "—"} pcs · {kg(l.ordered_kg)}</td><td>{l.shipped_pieces} pcs · {kg(l.shipped_kg)}</td><td className="font-bold">{l.loaded_bundles} bdl · {l.loaded_pieces} pcs · {kg(l.loaded_kg)}</td>
          <td className={l.open_pieces !== null && l.open_pieces < 0 ? "font-bold text-rose-700" : ""}>{l.open_pieces ?? "—"} pcs · {kg(l.open_kg)}</td></tr>)}</tbody></table></div>
        : <Empty>This order has no lines to plan against.</Empty>}
      {plan?.unplanned ? <p className="text-sm text-amber-900">Outside the order lines: {plan.unplanned.bundles} bundle(s), {kg(plan.unplanned.kg)}.</p> : null}
    </Section>

    <Section title={`Scans (${active.length} on the vehicle)`}>
      {(session.scans ?? []).length ? <ul className="space-y-1 text-sm">{(session.scans ?? []).map(s => <li key={s.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-1 ${s.outcome === "refused" ? "bg-rose-50" : s.removed_at ? "bg-neutral-50 text-neutral-500 line-through" : ""}`}>
        <span className="min-w-0 break-all"><b className="font-mono">{s.tag}</b> · {s.outcome === "loaded" ? `${s.pieces} pcs, ${kg(s.net_kg)}` : s.message}{s.warnings.length ? ` · ${s.warnings.map(w => SCAN_WARNING_LABELS[w] ?? w).join(", ")}` : ""}{s.confirm_note ? ` · note: ${s.confirm_note}` : ""}{s.remove_reason ? ` · removed: ${s.remove_reason}` : ""}</span>
        <span className="flex items-center gap-2 text-xs text-neutral-500">{fmtWhen(s.scanned_at)}
          {open && s.outcome === "loaded" && !s.removed_at ? removing?.id === s.id ? <span className="flex gap-1"><input aria-label="Why remove" className="h-9 rounded-lg border px-2 text-sm" value={removing.reason} onChange={e => setRemoving({ id: s.id, reason: e.target.value })} />
            <button type="button" className="underline" onClick={async () => { const r = await apWrite<Session>("ap_dispatch", "remove", { scan_id: s.id, reason: removing.reason.trim() }, setMessage, "Bundle taken off the vehicle."); if (r) { setSession(r); setRemoving(null); } }}>Remove</button></span>
            : <button type="button" aria-label={`Remove ${s.tag}`} onClick={() => setRemoving({ id: s.id, reason: "" })}><Trash2 className="h-4 w-4" aria-hidden="true" /></button> : null}</span>
      </li>)}</ul> : <Empty>No bundle scanned yet.</Empty>}
    </Section>

    {open || session.dispatch_id ? <FreightPanel kind={session.dispatch_id ? "dispatch" : "loading"} id={session.dispatch_id ?? session.id} today={today} /> : null}

    {open ? <Section title="Finish">
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !active.length} className={buttonClass} onClick={() => complete(false)}>Complete loading ({active.length} bundle{active.length === 1 ? "" : "s"})</button>
        <CancelSession sessionId={sessionId} onDone={reload} />
      </div>
      {duplicates ? <div role="alert" className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><p className="font-semibold">A dispatch with the same weight was recorded recently for this order:</p>
        <ul>{duplicates.map(d => <li key={d.id}><Link className="underline" href={d.href}>{d.label}</Link> ({d.why})</li>)}</ul>
        <button type="button" className={buttonClass} onClick={() => complete(true)}>It is a different load: complete anyway</button></div> : null}
      <p className="text-xs text-neutral-600">Completing posts stock through the normal dispatch: it rechecks QC release, packaging, reservations and credit, and refuses anything not ready.</p>
    </Section> : null}
    <Message value={message} />
  </div>;
}

function CancelSession({ sessionId, onDone }: { sessionId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false); const [reason, setReason] = useState(""); const [message, setMessage] = useState<Note>(null);
  if (!open) return <button type="button" className={secondaryClass} onClick={() => setOpen(true)}>Cancel load</button>;
  return <span className="flex flex-wrap gap-2"><input aria-label="Why cancel" className={`${inputClass} w-64`} value={reason} onChange={e => setReason(e.target.value)} placeholder="For example: truck did not arrive" />
    <button type="button" className={secondaryClass} onClick={async () => { if (await apWrite("ap_dispatch", "cancel", { id: sessionId, reason: reason.trim() }, setMessage, "Load cancelled; its bundles are free again.")) onDone(); }}>Cancel load</button><Message value={message} /></span>;
}
