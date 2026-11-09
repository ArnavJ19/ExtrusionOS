"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { executionAction } from "@/lib/actions/execution";
import { canUseExecutionAction, executionListSchema, type ExecutionMutation, type ExecutionRow } from "@/lib/workflow/execution";
import { ExecutionLookup } from "./mutation-form";
import { useExecutionAction } from "./action-center";
import { formatDate } from "@/lib/utils/format";

type Filters = { search: string; state: "active" | "all"; status?: string; sort: "priority" | "newest" | "due" };
const FIELD_LABEL = { assigned_to: "Assignee", priority: "Priority", due_date: "Planned date" } as const;

/**
 * NOV-014: small updates directly from the work queue. The selection is explicit: tasks on this page, or
 * every task matching the filter up to a stated limit. Nothing changes until the reviewed result is confirmed.
 */
export function QueuePanel({ rows, total, role, filters }: { rows: ExecutionRow[]; total: number; role: string; filters: Filters }) {
  const { locked, review } = useExecutionAction();
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"page" | "filtered">("page");
  const [field, setField] = useState<keyof typeof FIELD_LABEL>("priority");
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const permitted = canUseExecutionAction(role, "queue.update");
  const count = Object.keys(chosen).length;
  const allOnPage = rows.length > 0 && rows.every(row => row.id in chosen);

  function toggle(row: ExecutionRow, on: boolean) {
    setMode("page"); setMessage("");
    setChosen(current => { const next = { ...current }; if (on) next[row.id] = String(row.details.version); else delete next[row.id]; return next; });
  }
  function togglePage(on: boolean) {
    setMode("page"); setMessage("");
    setChosen(on ? Object.fromEntries(rows.map(row => [row.id, String(row.details.version)])) : {});
  }
  async function selectFiltered() {
    setBusy(true); setMessage("");
    try {
      if (total > 50) { setMessage(`${total} tasks match this filter. Narrow it to 50 or fewer to select them all; nothing was selected.`); return; }
      const collected: Record<string, string> = {};
      for (let page = 1; page <= Math.max(1, Math.ceil(total / 10)); page++) {
        const result = await executionAction({ command: "list", view: "queue", page, ...filters });
        if (!result.success) { setMessage(result.error); return; }
        const parsed = executionListSchema.safeParse(result.data);
        if (!parsed.success) { setMessage("The matching tasks could not be read. Nothing was selected."); return; }
        for (const row of parsed.data.rows) collected[row.id] = String(row.details.version);
      }
      setChosen(collected); setMode("filtered");
      setMessage(`${Object.keys(collected).length} task(s) matching the filter are selected.`);
    } catch { setMessage("The matching tasks could not be read. Nothing was selected."); }
    finally { setBusy(false); }
  }
  async function submit() {
    setMessage("");
    if (!count) { setMessage("Select at least one task."); return; }
    if (!value) { setMessage(`Choose the new ${FIELD_LABEL[field].toLowerCase()}.`); return; }
    if (mode === "page" && count > 10) { setMessage("A page selection holds at most 10 tasks."); return; }
    await review({ action: "queue.update", selection: mode, field, value, records: Object.entries(chosen).map(([id, version]) => ({ id, version })) } as ExecutionMutation);
  }
  if (!rows.length) return null;
  return <div className="space-y-4">
    <ul className="divide-y rounded-2xl border border-slate-200 bg-white">{rows.map(row => <li key={row.id} className="flex min-w-0 items-start gap-3 p-4">
      {permitted ? <input type="checkbox" className="mt-1 h-5 w-5" aria-label={`Select ${row.label}`} checked={row.id in chosen} disabled={locked} onChange={event => toggle(row, event.target.checked)} /> : null}
      <div className="min-w-0 flex-1 space-y-1"><div className="flex flex-wrap items-start justify-between gap-2"><Link href={row.source_href ?? "/tasks"} className="break-words font-bold underline">{row.label}</Link><Badge value={row.status} /></div>
        <p className="break-words text-sm text-slate-600">{row.summary}</p><p className="text-xs font-semibold text-slate-500">{row.due_date ? `Planned ${formatDate(row.due_date)}` : "No planned date"}</p></div></li>)}</ul>
    {permitted ? <section aria-label="Update selected tasks" className="space-y-3 rounded-2xl border border-slate-300 bg-white p-4">
      <h2 className="font-bold">Update selected tasks</h2>
      <div className="flex flex-wrap gap-2">
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" className="h-5 w-5" checked={allOnPage} disabled={locked} onChange={event => togglePage(event.target.checked)} />Select every task on this page</label>
        <Button type="button" variant="secondary" disabled={locked || busy} onClick={() => void selectFiltered()}>Select all {total} matching this filter</Button>
        {count ? <Button type="button" variant="secondary" disabled={locked} onClick={() => { setChosen({}); setMode("page"); setMessage(""); }}>Clear selection</Button> : null}
      </div>
      <p role="status" className="text-sm font-semibold">{count ? `${count} task(s) selected (${mode === "page" ? "chosen from this page" : "everything matching the filter"}).` : "No tasks selected."} At most 10 from a page or 50 matching a filter.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1"><span className="form-label">Change</span><select className="form-input" value={field} disabled={locked} onChange={event => { setField(event.target.value as keyof typeof FIELD_LABEL); setValue(""); }}>
          {Object.entries(FIELD_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <div className="space-y-1"><span className="form-label">New value</span>
          {field === "assigned_to" ? <ExecutionLookup field={{ key: "value", label: "assignee" }} kind="employees" value={value} disabled={locked} inputId="queue-value" onChange={setValue} />
            : field === "priority" ? <select className="form-input" aria-label="New priority" value={value} disabled={locked} onChange={event => setValue(event.target.value)}><option value="" disabled>Choose</option>{["low", "normal", "high", "urgent"].map(p => <option key={p} value={p}>{p}</option>)}</select>
            : <input className="form-input" type="date" aria-label="New planned date" value={value} disabled={locked} onChange={event => setValue(event.target.value)} />}</div>
      </div>
      {message ? <p role="alert" className="text-sm font-semibold text-red-800">{message}</p> : null}
      <p className="text-xs text-slate-600">You will see each task and what will happen to it before anything changes. Stock, money and status changes stay in their own workflows.</p>
      <Button type="button" disabled={locked || busy} onClick={() => void submit()}>Review the update</Button>
    </section> : <p className="text-sm text-slate-600">Your role can read the queue but not update it.</p>}
  </div>;
}
