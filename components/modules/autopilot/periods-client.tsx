"use client";

// AP-059: month close. A closed month accepts no new or re-dated entries until a second person approves a time-boxed
// reopen; every posting made in that window is recorded. Entries dated well before they are made are flagged for review.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { autopilotAction } from "@/lib/actions/autopilot";
import { FLAG_TABLE_LABELS, PERIOD_STATE_LABELS, periodFlagsSchema, periodOverviewSchema, type PeriodFlags, type PeriodOverview } from "@/lib/periods/periods";

export function PeriodsClient({ initial, userId }: { initial: PeriodOverview; userId: string }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ kind: "close" | "reopen"; month: string; reason: string } | null>(null);
  const [decision, setDecision] = useState<{ id: string; note: string } | null>(null);
  const [flags, setFlags] = useState<PeriodFlags | null>(null);
  const [flagPage, setFlagPage] = useState(1);
  const [flagState, setFlagState] = useState<"open" | "all">("open");
  const [review, setReview] = useState<{ id: string; note: string } | null>(null);

  const loadFlags = useCallback(async () => {
    if (!data.can_close) return;
    const result = await autopilotAction("ap_period", "flags", { page: flagPage, state: flagState });
    const parsed = result.success ? periodFlagsSchema.safeParse(result.data) : null;
    if (parsed?.success) setFlags(parsed.data);
  }, [data.can_close, flagPage, flagState]);
  useEffect(() => { void loadFlags(); }, [loadFlags]);

  async function run(command: string, payload: Record<string, unknown>, done: string) {
    setBusy(true); setMessage(null);
    const result = await autopilotAction("ap_period", command, payload);
    setBusy(false);
    if (!result.success) { setMessage({ text: result.error, tone: "error" }); return false; }
    setMessage({ text: done, tone: "ok" });
    const fresh = await autopilotAction("ap_period", "overview", {});
    const parsed = fresh.success ? periodOverviewSchema.safeParse(fresh.data) : null;
    if (parsed?.success) setData(parsed.data);
    await loadFlags(); router.refresh();
    return true;
  }

  const flagPages = Math.max(1, Math.ceil((flags?.total_count ?? 0) / 10));
  return <div className="space-y-5">
    {message ? <p role={message.tone === "error" ? "alert" : "status"} className={`rounded-xl p-3 text-sm font-semibold ${message.tone === "error" ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>{message.text}</p> : null}
    <section className="min-w-0 space-y-3 rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="text-lg font-bold">Months</h2>
        <p className="text-sm text-neutral-600">Books are closed through <strong>{data.locked_through ?? "no date yet"}</strong>. Reopen windows last {data.policy.reopen_window_hours} hours; entries dated more than {data.policy.backdate_flag_days} days back are flagged.</p></div></div>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.months.map(month => <li key={month.month} className="min-w-0 rounded-xl border border-neutral-200 p-3 text-sm">
        <div className="flex items-center justify-between gap-2"><strong>{month.label}</strong>
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${month.state === "closed" ? "bg-neutral-200 text-neutral-800" : month.state === "reopened" ? "bg-amber-100 text-amber-900" : month.state === "open_ended" ? "bg-sky-50 text-sky-800" : "bg-emerald-50 text-emerald-800"}`}>{PERIOD_STATE_LABELS[month.state]}</span></div>
        {month.reopen && ["requested", "approved"].includes(month.reopen.status) ? <div className="mt-2 rounded-lg bg-neutral-50 p-2 text-xs">
          <p><strong>Reopen {month.reopen.status}</strong> by {month.reopen.requested_by ?? "employee"}: {month.reopen.reason}</p>
          {month.reopen.status === "approved" ? <p>Open until {new Date(month.reopen.window_ends_at ?? "").toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · {month.reopen.postings} posting(s) so far · approved by {month.reopen.decided_by}</p> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {month.reopen.status === "requested" && data.can_close && month.reopen.requested_by_id !== userId ? <button type="button" className="min-h-10 rounded-lg bg-neutral-950 px-3 font-bold text-white" onClick={() => setDecision({ id: month.reopen!.id, note: "" })}>Decide</button> : null}
            {month.reopen.status === "requested" && month.reopen.requested_by_id === userId ? <button type="button" disabled={busy} className="min-h-10 rounded-lg border px-3" onClick={() => run("withdraw_reopen", { id: month.reopen!.id }, "Request withdrawn.")}>Withdraw</button> : null}
            {month.reopen.status === "approved" && data.can_close ? <button type="button" disabled={busy} className="min-h-10 rounded-lg border px-3 font-bold" onClick={() => run("reclose", { id: month.reopen!.id }, `${month.label} closed again.`)}>Close again now</button> : null}
          </div>
          {decision?.id === month.reopen.id ? <div className="mt-2 space-y-2"><input className="h-10 w-full rounded-lg border border-neutral-300 px-2" placeholder="Decision note" value={decision.note} maxLength={300} onChange={event => setDecision({ ...decision, note: event.target.value })} />
            <div className="flex gap-2"><button type="button" disabled={busy || decision.note.trim().length < 5} className="min-h-10 rounded-lg bg-neutral-950 px-3 font-bold text-white disabled:opacity-50" onClick={async () => { if (await run("approve_reopen", { id: decision.id, note: decision.note.trim() }, "Reopen approved.")) setDecision(null); }}>Approve</button>
              <button type="button" disabled={busy || decision.note.trim().length < 5} className="min-h-10 rounded-lg border px-3 disabled:opacity-50" onClick={async () => { if (await run("reject_reopen", { id: decision.id, note: decision.note.trim() }, "Reopen rejected.")) setDecision(null); }}>Reject</button></div></div> : null}
        </div> : null}
        <div className="mt-2 flex flex-wrap gap-2">
          {month.state === "open_ended" && (data.can_close_month ?? data.can_close) ? <button type="button" className="min-h-10 rounded-lg border px-3 font-semibold" onClick={() => setForm({ kind: "close", month: month.month, reason: `Month close for ${month.label}` })}>Close month</button> : null}
          {month.state === "closed" && !(month.reopen && ["requested", "approved"].includes(month.reopen.status)) ? <button type="button" className="min-h-10 rounded-lg border px-3 font-semibold" onClick={() => setForm({ kind: "reopen", month: month.month, reason: "" })}>Request a reopen</button> : null}
        </div>
        {form?.month === month.month ? <div className="mt-2 space-y-2"><label className="block text-xs font-semibold">{form.kind === "close" ? "Reason for closing" : "Why must an entry be dated in this month?"}
          <textarea className="mt-1 min-h-16 w-full rounded-lg border border-neutral-300 p-2 text-sm" value={form.reason} maxLength={500} onChange={event => setForm({ ...form, reason: event.target.value })} /></label>
          <div className="flex gap-2"><button type="button" disabled={busy || form.reason.trim().length < 10} className="min-h-10 rounded-lg bg-neutral-950 px-3 font-bold text-white disabled:opacity-50"
            onClick={async () => { if (await run(form.kind === "close" ? "close_month" : "request_reopen", { month: form.month, reason: form.reason.trim() }, form.kind === "close" ? `${month.label} closed.` : "Reopen requested; another person decides it.")) setForm(null); }}>{form.kind === "close" ? "Close month" : "Send request"}</button>
            <button type="button" className="min-h-10 rounded-lg border px-3" onClick={() => setForm(null)}>Cancel</button></div></div> : null}
      </li>)}</ul>
    </section>
    {data.can_close ? <section className="min-w-0 space-y-3 rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">Back-dated entries</h2>
        <label className="text-sm font-semibold">Show <select className="ml-1 h-10 rounded-lg border border-neutral-300 bg-white px-2" value={flagState} onChange={event => { setFlagState(event.target.value as "open" | "all"); setFlagPage(1); }}><option value="open">Not reviewed</option><option value="all">All</option></select></label></div>
      <p className="text-sm text-neutral-600">Someone other than the person who made the entry reviews it.</p>
      {!flags ? <p className="text-sm text-neutral-500">Loading…</p> : !flags.rows.length ? <p className="rounded-xl border border-dashed border-neutral-300 p-4 text-sm text-neutral-600">No back-dated entries {flagState === "open" ? "waiting for review" : "recorded"}.</p>
        : <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-neutral-500"><th className="py-2 pr-3">Entry</th><th className="pr-3">Dated</th><th className="pr-3">Entered</th><th className="pr-3">By</th><th>Review</th></tr></thead>
          <tbody>{flags.rows.map(row => { const kind = FLAG_TABLE_LABELS[row.table_name]; return <tr key={row.id} className="border-b align-top">
            <td className="py-2 pr-3">{kind?.href ? <Link className="font-semibold underline" href={kind.href(row.record_id)}>{kind.label}</Link> : kind?.label ?? row.table_name}</td>
            <td className="pr-3">{row.entry_date} ({row.days_back} days back)</td><td className="pr-3">{row.recorded_on}</td><td className="pr-3">{row.actor ?? "-"}</td>
            <td>{row.reviewed_at ? <span className="text-xs">{row.reviewed_by}: {row.review_note}</span> : review?.id === row.id
              ? <div className="flex flex-wrap gap-2"><input className="h-10 min-w-40 flex-1 rounded-lg border border-neutral-300 px-2" value={review.note} maxLength={300} placeholder="What you checked" onChange={event => setReview({ ...review, note: event.target.value })} />
                <button type="button" disabled={busy || review.note.trim().length < 5} className="min-h-10 rounded-lg bg-neutral-950 px-3 font-bold text-white disabled:opacity-50" onClick={async () => { if (await run("review_flag", { id: row.id, note: review.note.trim() }, "Marked as reviewed.")) setReview(null); }}>Save</button></div>
              : <button type="button" className="min-h-10 rounded-lg border px-3" onClick={() => setReview({ id: row.id, note: "" })}>Review</button>}</td></tr>; })}</tbody></table></div>}
      {flagPages > 1 ? <div className="flex items-center justify-between text-sm"><button type="button" disabled={flagPage <= 1} onClick={() => setFlagPage(flagPage - 1)} className="min-h-10 rounded-lg border px-3 disabled:opacity-40">Previous</button><span>Page {flagPage} of {flagPages}</span>
        <button type="button" disabled={flagPage >= flagPages} onClick={() => setFlagPage(flagPage + 1)} className="min-h-10 rounded-lg border px-3 disabled:opacity-40">Next</button></div> : null}
    </section> : null}
  </div>;
}
