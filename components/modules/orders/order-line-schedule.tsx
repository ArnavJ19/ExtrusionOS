"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { orderLineScheduleAction } from "@/lib/actions/order-line-schedule";
import { formatDate, formatWeight } from "@/lib/utils/format";
import {
  LINE_PRIORITIES, describeScheduleChange, lineDueState, lineSupply,
  type LineHistory, type LinePriority, type LineQueue, type LineRequirement
} from "@/lib/workflow/order-line-schedule";

const dueTone = { overdue: "bg-red-100 text-red-800", due_soon: "bg-amber-100 text-amber-900", scheduled: "bg-slate-100 text-slate-700", fulfilled: "bg-emerald-100 text-emerald-800", none: "bg-slate-100 text-slate-500" } as const;
const dueText = { overdue: "Overdue", due_soon: "Due within 3 days", scheduled: "Scheduled", fulfilled: "Supplied", none: "No date" } as const;
const priorityTone: Record<string, string> = { urgent: "text-red-700", high: "text-amber-700", normal: "text-slate-700", low: "text-slate-500" };

function LineEditor({ line, onSaved }: { line: LineRequirement; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ required_date: line.line_required_date ?? "", priority: (line.line_priority ?? "") as LinePriority | "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const requestId = useRef<string | null>(null);

  async function save(clear = false) {
    if (busy) return;
    requestId.current ??= crypto.randomUUID();
    setBusy(true); setError("");
    const result = await orderLineScheduleAction({
      command: "schedule.set", order_item_id: line.order_item_id,
      required_date: clear ? null : form.required_date || null, priority: clear ? null : form.priority || null,
      reason: form.reason, expected_version: line.version, request_id: requestId.current
    });
    setBusy(false);
    if (!result.success) {
      setError(result.error); setUncertain(result.uncertain === true);
      if (!result.uncertain) requestId.current = null;
      return;
    }
    requestId.current = null; setUncertain(false);
    await onSaved();
  }

  return (
    <form className="mt-3 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="space-y-1"><span className="form-label">Line required date</span>
        <input type="date" className="form-input" value={form.required_date} disabled={busy || uncertain} onChange={(event) => setForm({ ...form, required_date: event.target.value })} />
      </label>
      <label className="space-y-1"><span className="form-label">Line priority</span>
        <select className="form-input" value={form.priority} disabled={busy || uncertain} onChange={(event) => setForm({ ...form, priority: event.target.value as LinePriority | "" })}>
          <option value="">Same as order</option>
          {Object.entries(LINE_PRIORITIES).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
      </label>
      <label className="space-y-1"><span className="form-label">Reason (recorded)</span>
        <input className="form-input" required maxLength={500} value={form.reason} disabled={busy || uncertain} placeholder="e.g. Site needs tracks before shutters" onChange={(event) => setForm({ ...form, reason: event.target.value })} />
      </label>
      <div className="flex flex-wrap gap-2 sm:col-span-3">
        <Button type="submit" disabled={busy || !form.reason.trim()}>{busy ? "Saving…" : uncertain ? "Retry the same change" : "Save line requirement"}</Button>
        {line.line_required_date || line.line_priority ? (
          <Button type="button" variant="secondary" disabled={busy || uncertain || !form.reason.trim()} onClick={() => void save(true)}>Use the order&apos;s date and priority</Button>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-sm font-semibold text-red-700 sm:col-span-3">{error}</p> : null}
    </form>
  );
}

// UPGRADE_EOS feature 38: each line's own delivery requirement, progress and change history.
export function OrderLineSchedulePanel({ orderId, initial, unavailableMessage, canWrite }: {
  orderId: string; initial: { rows: LineRequirement[]; today: string } | null; unavailableMessage: string | null; canWrite: boolean;
}) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [error, setError] = useState(unavailableMessage ?? "");
  const [editing, setEditing] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, LineHistory>>({});

  async function reload() {
    const result = await orderLineScheduleAction({ command: "schedule.lines", order_id: orderId });
    if (result.success) { setData(result.data as { rows: LineRequirement[]; today: string }); setError(""); setEditing(null); router.refresh(); }
    else setError(result.error);
  }

  async function loadHistory(lineId: string) {
    const result = await orderLineScheduleAction({ command: "schedule.history", order_item_id: lineId, page: 1 });
    if (result.success) setHistory({ ...history, [lineId]: result.data as LineHistory });
    else setError(result.error);
  }

  if (!data) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-bold text-slate-900">Line delivery requirements</h3>
        <p role="alert" className="mt-2 text-sm font-semibold text-amber-800">{error || "Line requirements could not be loaded."}</p>
      </section>
    );
  }
  if (!data.rows.length) return null;

  return (
    <section aria-labelledby="line-schedule-title" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 id="line-schedule-title" className="font-bold tracking-tight text-slate-900">Line delivery requirements</h3>
      <p className="mt-1 text-sm font-medium text-slate-500">A line without its own date or priority follows the order. Changes are recorded with a reason and carried into the production and dispatch queues; the order&apos;s stage is not changed.</p>
      <ul className="mt-3 divide-y divide-slate-100">
        {data.rows.map((line) => {
          const supply = lineSupply(line);
          const state = lineDueState(line.effective_date, data.today, supply.fulfilled);
          const lineHistory = history[line.order_item_id];
          return (
            <li key={line.order_item_id} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-slate-900">{line.line_label}{line.profile_code && line.profile_code !== line.line_label ? <span className="ml-2 text-xs font-semibold text-slate-500">{line.profile_code}</span> : null}</p>
                  <p className="mt-0.5 text-xs font-semibold text-slate-600">
                    Required {line.effective_date ? formatDate(line.effective_date) : "date not set"} {line.date_source === "line" ? "(line)" : line.date_source === "order" ? "(from order)" : ""}
                    {" · "}<span className={`font-black ${priorityTone[line.effective_priority] ?? ""}`}>{LINE_PRIORITIES[line.effective_priority as LinePriority] ?? line.effective_priority}</span> {line.priority_source === "line" ? "(line)" : "(from order)"}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Ordered {line.ordered_kg === null ? "quantity not set" : formatWeight(line.ordered_kg)} · produced {formatWeight(line.produced_kg)} · in open jobs {formatWeight(line.planned_open_kg)} · packed {formatWeight(line.packed_kg)}{line.from_stock_kg ? ` · from stock ${formatWeight(line.from_stock_kg)}` : ""}
                    {supply.remaining !== null && !supply.fulfilled ? ` · ${formatWeight(supply.remaining)} still to supply` : ""}
                  </p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-black ${dueTone[state]}`}>{dueText[state]}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs font-bold">
                {canWrite && !line.order_closed && !supply.fulfilled ? (
                  <button type="button" className="text-slate-700 underline" onClick={() => setEditing(editing === line.order_item_id ? null : line.order_item_id)}>{editing === line.order_item_id ? "Cancel" : "Change line requirement"}</button>
                ) : null}
                {line.version > 0 ? <button type="button" className="text-slate-600 underline" onClick={() => void loadHistory(line.order_item_id)}>Show changes</button> : null}
              </div>
              {editing === line.order_item_id ? <LineEditor line={line} onSaved={reload} /> : null}
              {lineHistory ? (
                <ul className="mt-2 space-y-1 text-xs text-slate-700">
                  {lineHistory.rows.map((row) => (
                    <li key={row.id} className="rounded-lg border border-slate-200 px-2 py-1"><span className="font-bold">{describeScheduleChange(row)}</span> — {row.reason} <span className="text-slate-500">({row.changed_by_name}, {formatDate(row.changed_at)})</span></li>
                  ))}
                  {lineHistory.total_count > lineHistory.rows.length ? <li className="text-slate-500">Showing the latest {lineHistory.rows.length} of {lineHistory.total_count} changes.</li> : null}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      {error ? <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p> : null}
    </section>
  );
}

const filters = { all: "All open lines", overdue: "Overdue", due_soon: "Due in 3 days", line_set: "Line-specific" } as const;

/** Production or dispatch queue of open order lines, overdue first, then priority and date. */
export function LineDeliveryQueue({ scope, initial, unavailableMessage }: { scope: "production" | "dispatch"; initial: LineQueue | null; unavailableMessage: string | null }) {
  const [data, setData] = useState(initial);
  const [filter, setFilter] = useState<keyof typeof filters>("all");
  const [page, setPage] = useState(1);
  const [error, setError] = useState(unavailableMessage ?? "");
  const [busy, setBusy] = useState(false);

  async function load(nextFilter: keyof typeof filters, nextPage: number) {
    setBusy(true);
    const result = await orderLineScheduleAction({ command: "schedule.queue", scope, filter: nextFilter, page: nextPage });
    setBusy(false);
    if (!result.success) { setError(result.error); return; }
    setData(result.data as LineQueue); setFilter(nextFilter); setPage(nextPage); setError("");
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total_count / 10)) : 1;
  return (
    <section aria-labelledby={`line-queue-${scope}`} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Line Delivery Requirements</p>
      <h2 id={`line-queue-${scope}`} className="section-title mt-1">{scope === "production" ? "Order lines still to produce" : "Order lines still to pack and dispatch"}</h2>
      <p className="mt-1 text-sm font-medium text-slate-500">Each line&apos;s own date and priority, or the order&apos;s when the line has none. Overdue lines first.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {Object.entries(filters).map(([value, text]) => (
          <button key={value} type="button" disabled={busy} onClick={() => void load(value as keyof typeof filters, 1)}
            className={`rounded-xl border px-3 py-1.5 text-xs font-bold ${filter === value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-700"}`}>{text}</button>
        ))}
      </div>
      {!data ? <p role="alert" className="mt-3 text-sm font-semibold text-amber-800">{error || "The line queue could not be loaded."}</p> : !data.rows.length ? (
        <p className="mt-3 text-sm font-medium text-slate-500">No open lines match this view.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {data.rows.map((row) => (
            <li key={row.order_item_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <Link href={`/orders/${row.order_id}`} className="font-bold text-slate-900 underline-offset-2 hover:underline">{row.order_number}</Link>
                <span className="ml-2 font-semibold text-slate-700">{row.line_label}</span>
                <span className="ml-2 text-xs text-slate-500">{row.customer_name ?? ""}</span>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs font-semibold">
                <span className="text-slate-600">{row.remaining_kg === null ? "Quantity not set" : `${formatWeight(row.remaining_kg)} remaining`}</span>
                <span className={`font-black ${priorityTone[row.effective_priority] ?? ""}`}>{LINE_PRIORITIES[row.effective_priority as LinePriority] ?? row.effective_priority}{row.priority_source === "line" ? " (line)" : ""}</span>
                <span className={`rounded-full px-2 py-0.5 font-black ${row.overdue ? dueTone.overdue : dueTone.scheduled}`}>{row.effective_date ? formatDate(row.effective_date) : "No date"}{row.date_source === "line" ? " (line)" : ""}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {data && totalPages > 1 ? (
        <div className="mt-3 flex items-center justify-between text-xs font-bold">
          <button type="button" disabled={busy || page <= 1} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40" onClick={() => void load(filter, page - 1)}>Previous</button>
          <span className="text-slate-500">Page {page} of {totalPages} · {data.total_count} lines</span>
          <button type="button" disabled={busy || page >= totalPages} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40" onClick={() => void load(filter, page + 1)}>Next</button>
        </div>
      ) : null}
      {data && error ? <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p> : null}
    </section>
  );
}
