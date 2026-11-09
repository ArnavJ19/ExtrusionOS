"use client";

// AP-002: one component for every system proposal. The card says what the system prepared and why; one person accepts,
// edits or rejects. Accepting re-runs the action on the server with its own checks; a stale proposal cannot be accepted.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Pencil, X } from "lucide-react";
import { autopilotAction } from "@/lib/actions/autopilot";
import { PROPOSAL_TYPES, proposalDecisionSchema, proposalListSchema, proposalStatusLabels, proposalSummary, proposalWhy, type ProposalList, type ProposalRow, type ProposalType } from "@/lib/proposals/proposals";
import { checkSeriesTemplate, type DocumentSeriesKey } from "@/lib/numbering/financial-year";
import { roleNavigationItemsSchema } from "@/lib/navigation/role-navigation";

type Props = { type?: ProposalType; initial: ProposalList | null; initialError?: string | null; title?: string; description?: string; today: string; emptyText?: string };

function EditFields({ row, onSubmit, onCancel, today }: { row: ProposalRow; onSubmit: (payload: Record<string, unknown>) => void; onCancel: () => void; today: string }) {
  const [items, setItems] = useState(((row.payload.items as string[]) ?? []).join("\n"));
  const [template, setTemplate] = useState(String(row.payload.prefix_template ?? ""));
  const [pad, setPad] = useState(String(row.payload.pad_width ?? 4));
  const [error, setError] = useState<string | null>(null);
  function submit() {
    if (row.proposal_type === "navigation.role_layout") {
      const parsed = roleNavigationItemsSchema.safeParse(items.split(/[\n,]+/).map(value => value.trim()).filter(Boolean));
      if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check the destinations");
      return onSubmit({ items: parsed.data });
    }
    const check = checkSeriesTemplate(row.target_key as DocumentSeriesKey, template, Number(pad), today);
    if (!check.ok) return setError(check.message);
    onSubmit({ prefix_template: template.trim().toUpperCase(), pad_width: Number(pad) });
  }
  return <div className="mt-3 space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
    {row.proposal_type === "navigation.role_layout"
      ? <label className="block text-sm font-semibold">Destinations, one per line (at most nine)<textarea className="mt-1 min-h-32 w-full rounded-xl border border-neutral-300 bg-white p-2 font-mono text-sm" value={items} onChange={event => setItems(event.target.value)} /></label>
      : <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-semibold">Format<input className="mt-1 h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 font-mono text-sm uppercase" value={template} onChange={event => setTemplate(event.target.value)} aria-describedby={`fmt-${row.id}`} /></label>
        <label className="block text-sm font-semibold">Running number digits<input className="mt-1 h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 text-sm" inputMode="numeric" value={pad} onChange={event => setPad(event.target.value.replace(/\D/g, ""))} /></label>
        <p id={`fmt-${row.id}`} className="text-xs text-neutral-600 sm:col-span-2">Use {"{FY}"} for 26-27 or {"{FY4}"} for 2026-27. Example now: {(() => { const check = checkSeriesTemplate(row.target_key as DocumentSeriesKey, template, Number(pad) || 0, today); return check.ok ? check.example : check.message; })()}</p>
      </div>}
    {error ? <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p> : null}
    <div className="flex flex-wrap gap-2"><button type="button" onClick={submit} className="min-h-11 rounded-xl bg-neutral-950 px-4 text-sm font-bold text-white">Accept with these changes</button>
      <button type="button" onClick={onCancel} className="min-h-11 rounded-xl border border-neutral-300 bg-white px-4 text-sm font-bold">Cancel</button></div>
  </div>;
}

export function ProposalCards({ type, initial, initialError = null, title = "Waiting for your confirmation", description, today, emptyText }: Props) {
  const router = useRouter();
  const [list, setList] = useState<ProposalList | null>(initial);
  const [error, setError] = useState<string | null>(initialError);
  const [status, setStatus] = useState<"open" | "decided">("open");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (nextStatus = status, nextPage = page) => {
    const result = await autopilotAction("ap_proposals", "list", { status: nextStatus, page: nextPage, ...(type ? { type } : {}) });
    const parsed = result.success ? proposalListSchema.safeParse(result.data) : null;
    if (!parsed?.success) { setError(result.success ? "Proposals could not be read." : result.error); return; }
    setError(null); setList(parsed.data);
  }, [page, status, type]);

  useEffect(() => { if (status !== "open" || page !== 1) void load(status, page); }, [status, page, load]);

  const decidable = useMemo(() => (list?.rows ?? []).filter(row => row.can_decide && !row.stale_now), [list]);
  const selected = decidable.filter(row => !excluded.has(row.id));

  async function decide(row: ProposalRow, decision: "accept" | "reject" | "edit", payload?: Record<string, unknown>, note?: string) {
    setBusy(row.id); setMessage(null);
    const result = await autopilotAction("ap_proposals", "decide", { id: row.id, decision, ...(payload ? { payload } : {}), ...(note ? { note } : {}) });
    setBusy(null);
    if (!result.success) { setMessage(result.error); return; }
    const outcome = proposalDecisionSchema.safeParse(result.data);
    const state = outcome.success ? outcome.data.state : "accepted";
    setMessage(state === "stale" || state === "expired" ? (outcome.success ? outcome.data.message ?? "" : "") : `${row.title}: ${proposalStatusLabels[state as keyof typeof proposalStatusLabels] ?? state}.`);
    setEditing(null); setRejecting(null); setRejectNote("");
    await load(); router.refresh();
  }

  async function acceptSelected() {
    if (!selected.length) return;
    setBusy("batch"); setMessage(null);
    const result = await autopilotAction("ap_proposals", "decide_batch", { ids: selected.map(row => row.id), decision: "accept" });
    setBusy(null);
    if (!result.success) { setMessage(result.error); return; }
    const results = (result.data as { results: Array<{ state: string; message?: string }> }).results;
    const accepted = results.filter(item => item.state === "accepted").length;
    const other = results.filter(item => item.state !== "accepted");
    setMessage(`${accepted} accepted${other.length ? `; ${other.length} not applied: ${other.map(item => item.message ?? item.state).join("; ")}` : ""}.`);
    setExcluded(new Set()); await load(); router.refresh();
  }

  const rows = list?.rows ?? [];
  const pages = Math.max(1, Math.ceil((list?.total_count ?? 0) / 10));
  return <section className="min-w-0 space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5" aria-labelledby={`proposals-${type ?? "all"}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 id={`proposals-${type ?? "all"}`} className="text-lg font-bold">{title}</h2>
        <p className="text-sm text-neutral-600">{description ?? "The system prepared these from existing records. Nothing changes until you accept."}</p></div>
      <div className="flex rounded-xl border border-neutral-200 p-1 text-sm font-semibold" role="group" aria-label="Show proposals">
        {(["open", "decided"] as const).map(value => <button key={value} type="button" aria-pressed={status === value} onClick={() => { setStatus(value); setPage(1); }}
          className={`min-h-9 rounded-lg px-3 ${status === value ? "bg-neutral-950 text-white" : "text-neutral-700"}`}>{value === "open" ? "Waiting" : "Decided"}</button>)}
      </div>
    </div>
    {message ? <p role="status" className="rounded-xl bg-neutral-50 p-3 text-sm font-semibold">{message}</p> : null}
    {error ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">{error}</p>
      : !list ? <p className="text-sm text-neutral-500">Loading proposals…</p>
      : !rows.length ? <p className="rounded-xl border border-dashed border-neutral-300 p-4 text-sm text-neutral-600">{status === "open" ? emptyText ?? "Nothing is waiting. Scheduled jobs prepare new proposals when the facts call for one." : "No decided proposals yet."}</p>
      : <>
        {status === "open" && decidable.length > 1 ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-neutral-50 p-3 text-sm">
          <span>{selected.length} of {decidable.length} selected. Untick any you want to look at separately.</span>
          <button type="button" disabled={busy !== null || !selected.length} onClick={acceptSelected} className="min-h-11 rounded-xl bg-neutral-950 px-4 font-bold text-white disabled:opacity-50">Accept selected ({selected.length})</button>
        </div> : null}
        <ul className="space-y-3">{rows.map(row => <li key={row.id} id={`proposal-${row.id}`} className="min-w-0 rounded-xl border border-neutral-200 p-3 sm:p-4">
          <div className="flex flex-wrap items-start gap-3">
            {status === "open" && row.can_decide && !row.stale_now && decidable.length > 1
              ? <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" aria-label={`Include ${row.title} in the batch`} checked={!excluded.has(row.id)}
                onChange={event => setExcluded(previous => { const next = new Set(previous); if (event.target.checked) next.delete(row.id); else next.add(row.id); return next; })} /> : null}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><p className="font-bold [overflow-wrap:anywhere]">{row.title}</p>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-bold text-neutral-700">{PROPOSAL_TYPES[row.proposal_type].label}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${row.status === "open" ? "bg-sky-50 text-sky-800" : row.status === "rejected" || row.status === "stale" || row.status === "expired" ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}>{proposalStatusLabels[row.status]}</span></div>
              <p className="mt-1 text-sm [overflow-wrap:anywhere]">{proposalSummary(row)}</p>
              <details className="mt-2 text-sm text-neutral-700"><summary className="cursor-pointer font-semibold">Why this was proposed</summary>
                <ul className="mt-1 list-disc space-y-1 pl-5">{proposalWhy(row).map((line, index) => <li key={index} className="[overflow-wrap:anywhere]">{line}</li>)}</ul></details>
              {row.stale_now ? <p className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-sm font-semibold text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />The facts behind this changed after it was prepared. It cannot be accepted; the next scheduled run prepares a current one.</p> : null}
              {row.status !== "open" ? <p className="mt-2 text-xs text-neutral-600">{row.decided_by ? `${row.decided_by}, ${new Date(row.decided_at ?? row.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}` : "Closed by the system"}{row.edited_fields.length ? ` · changed ${row.edited_fields.join(", ")}` : ""}{row.decision_note ? ` · “${row.decision_note}”` : ""}</p> : null}
              {status === "open" && row.can_decide && !row.stale_now ? <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={busy !== null} onClick={() => decide(row, "accept")} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-bold text-white disabled:opacity-50"><Check className="h-4 w-4" aria-hidden="true" />Accept</button>
                {row.editable.length ? <button type="button" disabled={busy !== null} onClick={() => setEditing(editing === row.id ? null : row.id)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-neutral-300 bg-white px-4 text-sm font-bold"><Pencil className="h-4 w-4" aria-hidden="true" />Edit</button> : null}
                <button type="button" disabled={busy !== null} onClick={() => setRejecting(rejecting === row.id ? null : row.id)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-neutral-300 bg-white px-4 text-sm font-bold"><X className="h-4 w-4" aria-hidden="true" />Reject</button>
              </div> : status === "open" && !row.can_decide ? <p className="mt-2 text-xs text-neutral-600">Another role decides this proposal.</p> : null}
              {editing === row.id ? <EditFields row={row} today={today} onCancel={() => setEditing(null)} onSubmit={payload => decide(row, "edit", payload)} /> : null}
              {rejecting === row.id ? <div className="mt-3 space-y-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                <label className="block text-sm font-semibold">Why are you rejecting it?<input className="mt-1 h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 text-sm" value={rejectNote} maxLength={300} onChange={event => setRejectNote(event.target.value)} /></label>
                <button type="button" disabled={busy !== null || rejectNote.trim().length < 3} onClick={() => decide(row, "reject", undefined, rejectNote.trim())} className="min-h-11 rounded-xl bg-rose-600 px-4 text-sm font-bold text-white disabled:opacity-50">Reject proposal</button>
              </div> : null}
            </div>
          </div>
        </li>)}</ul>
        {pages > 1 ? <nav className="flex items-center justify-between text-sm" aria-label="Proposal pages">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="inline-flex min-h-10 items-center gap-1 rounded-lg border px-3 disabled:opacity-40"><ChevronLeft className="h-4 w-4" aria-hidden="true" />Previous</button>
          <span>Page {page} of {pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="inline-flex min-h-10 items-center gap-1 rounded-lg border px-3 disabled:opacity-40">Next<ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
        </nav> : null}
      </>}
  </section>;
}
