"use client";

import { useState } from "react";
import { REORDER_STATES } from "@/lib/autopilot-batch6/commands";
import { fmtDay, fmtWhen } from "@/lib/order-to-cash/commands";
import { ProposalCards } from "../autopilot/proposal-cards";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, inputClass, useApRead } from "../order-to-cash/ui";
import { Action, Field, Filters, NumberInput, Stat, Why, num, optional, write, type Note, type Queue } from "./shared";

type Row = { source: "inventory_items" | "packaging_materials"; id: string; label: string; code: string | null; unit: string | null; stock: number; current_reorder_level: number | null;
  consumed_90d: number; window_days: number; avg_daily: number | null; lead_days: number | null; safety_days: number | null; safety_basis: string | null; review_days: number;
  suggested_min: number | null; suggested_qty: number | null; state: string; approved_min: number | null; approved_qty: number | null; approved_at: string | null; approved_by: string | null;
  below_min: boolean; open_requisitions: number; differs: boolean; basis: string };

export function ReorderClient({ canApprove }: { canApprove: boolean }) {
  const [search, setSearch] = useState(""); const [show, setShow] = useState("attention"); const [kind, setKind] = useState("all"); const [page, setPage] = useState(1); const [rev, setRev] = useState(0);
  const read = useApRead<Queue<Row> & { coverage: Record<string, number>; basis: string }>("ap_reorder", "suggestions", { page, search, show, kind }, [rev]);
  const [note, setNote] = useState<Note>(null);
  return <div className="space-y-5">
    <Section title="Reorder points" description="Suggested from 90-day consumption and supplier lead time. They trigger requisitions only after stores approves them.">
      <Filters search={search} setSearch={v => { setSearch(v); setPage(1); }} show={show} setShow={v => { setShow(v); setPage(1); }} options={[["attention", "Needs approval or below the point"], ["all", "All active items"]]} />
      <div className="max-w-xs"><Field label="Kind"><select className={inputClass} value={kind} onChange={e => { setKind(e.target.value); setPage(1); }}><option value="all">All consumables</option><option value="inventory">Stores items</option><option value="packaging">Packing material</option></select></Field></div>
      <Message value={note} />
      <Action secondary run={async () => { await write("ap_reorder", "prepare", {}, setNote, "Checked. Items at their approved point have a requisition proposal."); setRev(v => v + 1); }}>Check stock against approved points</Action>
      {read.error ? <Failure text={read.error} /> : read.loading && !read.data ? <Loading what="reorder points" /> : read.data ? <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat label="Active consumables" value={read.data.coverage.active ?? 0} /><Stat label="With an approved point" value={read.data.coverage.approved ?? 0} tone={(read.data.coverage.approved ?? 0) < (read.data.coverage.active ?? 0) ? "warn" : "ok"} />
          <Stat label="At or below the point" value={read.data.coverage.below_min ?? 0} tone={read.data.coverage.below_min ? "bad" : undefined} /><Stat label="Lead time missing" value={read.data.coverage.lead_time_missing ?? 0} tone={read.data.coverage.lead_time_missing ? "warn" : undefined} /></div>
        <p className="text-xs text-neutral-600">{read.data.basis}</p>
        {!read.data.rows.length ? <Empty>No item needs attention.</Empty> : <div className="space-y-3">{read.data.rows.map(r => <ReorderRow key={`${r.source}:${r.id}:${r.lead_days}:${r.suggested_min}:${r.suggested_qty}:${r.approved_min}`} row={r} canApprove={canApprove} notify={setNote} onSaved={() => setRev(v => v + 1)} />)}</div>}
        <Pager page={page} total={read.data.total_count} onPage={setPage} />
      </> : null}
    </Section>
    <ProposalCards key={rev} initial={null} type="stock.reorder" today="" title="Requisitions to accept" emptyText="No requisition proposal is waiting." />
    <Requisitions rev={rev} canUpdate={canApprove} />
  </div>;
}

// Results are shown above the list (notify): saving re-reads the row, which then remounts with its new suggestion.
function ReorderRow({ row, canApprove, onSaved, notify: setNote }: { row: Row; canApprove: boolean; onSaved: () => void; notify: (n: Note) => void }) {
  const [lead, setLead] = useState(row.lead_days == null ? "" : String(row.lead_days)); const [safety, setSafety] = useState("");
  const [min, setMin] = useState(row.suggested_min == null ? "" : String(row.suggested_min)); const [qty, setQty] = useState(row.suggested_qty == null ? "" : String(row.suggested_qty)); const [reason, setReason] = useState("");
  const unit = row.unit ?? "";
  return <article className="min-w-0 rounded-xl border p-3">
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h3 className="font-bold">{row.label}</h3><p className="text-xs text-neutral-600">{row.code ?? ""} · {row.source === "inventory_items" ? "Stores item" : "Packing material"}</p></div>
      <div className="flex flex-wrap gap-1">{row.below_min ? <Pill value="rejected" label="At or below the point" /> : null}<Pill value={row.approved_min != null ? "approved" : "pending"} label={row.approved_min != null ? "Approved" : REORDER_STATES[row.state] ?? row.state} /></div></div>
    <p className="mt-2 text-sm">Stock {num(row.stock)} {unit} · used {num(row.consumed_90d)} {unit} over {row.window_days} day(s) (≈ {num(row.avg_daily, 3)} {unit}/day)</p>
    <p className="text-sm">Suggested point <strong>{row.suggested_min == null ? "—" : `${num(row.suggested_min)} ${unit}`}</strong>, reorder <strong>{row.suggested_qty == null ? "—" : `${num(row.suggested_qty)} ${unit}`}</strong>
      {row.approved_min != null ? <> · approved {num(row.approved_min)} / {num(row.approved_qty)} by {row.approved_by ?? "—"} {fmtWhen(row.approved_at)}{row.differs ? " (suggestion has moved)" : ""}</> : null}
      {row.open_requisitions ? ` · ${row.open_requisitions} open requisition` : ""}</p>
    <Why value={{ basis: row.basis, lead_days: row.lead_days, safety_days: row.safety_days, safety_basis: row.safety_basis, review_days: row.review_days }} />
    {canApprove ? <div className="mt-2 space-y-3 border-t pt-3">
      <div className="grid gap-3 sm:grid-cols-3"><Field label="Supplier lead time (days)"><NumberInput value={lead} onChange={setLead} /></Field>
        <Field label="Safety days" hint="Blank: half the lead time"><NumberInput value={safety} onChange={setSafety} /></Field>
        <div className="flex items-end"><Action secondary disabled={!lead.trim()} run={async () => { if (await write("ap_reorder", "save_lead", { source: row.source, id: row.id, lead_days: Number(lead), ...(optional(safety) !== undefined ? { safety_days: optional(safety) } : {}) }, setNote, "Lead time saved; the suggestion is recalculated.")) onSaved(); }}>Save lead time</Action></div></div>
      <div className="grid gap-3 sm:grid-cols-3"><Field label={`Reorder point (${unit})`}><NumberInput value={min} onChange={setMin} /></Field><Field label={`Reorder quantity (${unit})`}><NumberInput value={qty} onChange={setQty} /></Field>
        <Field label="Reason if different from the suggestion"><input className={inputClass} value={reason} maxLength={300} onChange={e => setReason(e.target.value)} /></Field></div>
      <Action disabled={!min.trim() || !qty.trim()} run={async () => { if (await write("ap_reorder", "approve", { source: row.source, id: row.id, min_level: Number(min), reorder_qty: Number(qty), ...(reason.trim() ? { reason: reason.trim() } : {}) }, setNote, "Reorder point approved.")) onSaved(); }}>Approve these levels</Action>
    </div> : null}
  </article>;
}

type Requisition = { id: string; item_label: string; unit: string | null; quantity: number; need_by: string | null; status: string; reference: string | null; status_note: string | null; created_at: string; created_by_name: string | null };
function Requisitions({ rev, canUpdate }: { rev: number; canUpdate: boolean }) {
  const [status, setStatus] = useState("open"); const [page, setPage] = useState(1); const [local, setLocal] = useState(0); const [note, setNote] = useState<Note>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const read = useApRead<Queue<Requisition>>("ap_reorder", "requisitions", { page, status }, [rev, local]);
  return <Section title="Purchase requisitions" description="Raised when an accepted proposal confirms the quantity. Mark ordered when the purchase order is raised.">
    <div className="max-w-xs"><Field label="Status"><select className={inputClass} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="open">Open</option><option value="ordered">Ordered</option><option value="cancelled">Cancelled</option><option value="all">All</option></select></Field></div>
    <Message value={note} />
    {read.error ? <Failure text={read.error} /> : read.loading && !read.data ? <Loading what="requisitions" /> : read.data ? <>
      {!read.data.rows.length ? <Empty>No requisitions.</Empty> : <ul className="divide-y">{read.data.rows.map(r => <li key={r.id} className="space-y-2 py-3 text-sm">
        <p><strong>{r.item_label}</strong> · {num(r.quantity)} {r.unit ?? ""} · need by {fmtDay(r.need_by)} · <Pill value={r.status} /> {r.reference ? `· PO ${r.reference}` : ""} {r.status_note ? `· ${r.status_note}` : ""}</p>
        {canUpdate && r.status === "open" ? <div className="flex flex-wrap items-end gap-2"><div className="w-48"><Field label="PO reference or reason"><input className={inputClass} value={refs[r.id] ?? ""} onChange={e => setRefs(x => ({ ...x, [r.id]: e.target.value }))} /></Field></div>
          <Action secondary disabled={(refs[r.id] ?? "").trim().length < 2} run={async () => { await write("ap_reorder", "update_requisition", { id: r.id, status: "ordered", reference: refs[r.id].trim() }, setNote, "Marked ordered."); setLocal(v => v + 1); }}>Mark ordered</Action>
          <Action secondary disabled={(refs[r.id] ?? "").trim().length < 3} run={async () => { await write("ap_reorder", "update_requisition", { id: r.id, status: "cancelled", note: refs[r.id].trim() }, setNote, "Cancelled."); setLocal(v => v + 1); }}>Cancel</Action></div> : null}
      </li>)}</ul>}
      <Pager page={page} total={read.data.total_count} onPage={setPage} />
    </> : null}
  </Section>;
}
