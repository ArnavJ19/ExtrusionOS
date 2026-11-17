"use client";

import { useState } from "react";
import Link from "next/link";
import { fmtDay, fmtWhen, inr } from "@/lib/order-to-cash/commands";
import { ProposalCards } from "../autopilot/proposal-cards";
import { Empty, Failure, Loading, Message, Pager, Section, useApRead } from "../order-to-cash/ui";
import { Action, Stat, pct, write, type Note, type Queue } from "./shared";

type Line = { quote_item_id: string; item_label: string; alloy: string | null; old_rate: number | null; new_rate: number; old_line_total: number | null; new_line_total: number | null };
type Draft = { quote_id: string; quote_number: string; customer: string | null; status: string; lines: Line[]; blocked_lines?: Line[]; blocked?: string; lines_without_rate: number;
  old_grand_total: number | null; new_grand_total: number | null; change: number | null };
type Impact = { today: string; fingerprint: string; drafts: Draft[]; sent: { quote_id: string; quote_number: string; customer: string | null; valid_until: string | null; sent_rate: number; today_rate: number; change_percent: number | null }[];
  approved_unsent: { quote_id: string; quote_number: string }[]; rates: { id: string; rate: number; alloy: string | null; customer_specific: boolean; effective_from: string }[]; quote_count: number; line_count: number; basis: string };

export function RepriceClient({ canApply }: { canApply: boolean }) {
  const [rev, setRev] = useState(0); const [note, setNote] = useState<Note>(null); const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const read = useApRead<Impact>("ap_reprice", "impact", {}, [rev]);
  const v = read.data;
  const changing = v?.drafts.filter(d => d.lines.length && !excluded.has(d.quote_id)) ?? [];
  return <div className="space-y-5">
    <Section title="Impact of today's billet rate" description="Draft quotations repriced in one action. Sent quotations keep the rate they were sent with.">
      <Message value={note} />
      {read.error ? <Failure text={read.error} /> : read.loading && !v ? <Loading what="impact list" /> : v ? <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Approved billet rate today" value={v.rates.length ? v.rates.filter(r => !r.customer_specific && !r.alloy).map(r => inr(r.rate)).join(", ") || `${v.rates.length} scoped rate(s)` : "None approved"} tone={v.rates.length ? undefined : "warn"} />
          <Stat label="Drafts to reprice" value={v.quote_count} /><Stat label="Lines" value={v.line_count} /><Stat label="Sent, rate moved" value={v.sent.length} tone={v.sent.length ? "warn" : undefined} />
        </div>
        <p className="text-xs text-neutral-600">{v.basis} <Link className="underline" href="/quotes/rates">Approved rates</Link></p>
        {!v.drafts.length ? <Empty>Every draft already uses today&apos;s approved rate.</Empty> : <div className="space-y-3">{v.drafts.map(d => <article key={d.quote_id} className="min-w-0 rounded-xl border p-3">
          <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><Link className="font-bold underline" href={`/quotes/${d.quote_id}`}>{d.quote_number}</Link> <span className="text-sm text-neutral-600">{d.customer ?? ""} · {d.status.replaceAll("_", " ")}</span></div>
            {d.lines.length ? <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={!excluded.has(d.quote_id)} onChange={e => setExcluded(s => { const n = new Set(s); if (e.target.checked) n.delete(d.quote_id); else n.add(d.quote_id); return n; })} />Include</label> : null}</div>
          {d.blocked ? <p className="mt-2 rounded-xl bg-amber-50 p-2 text-sm text-amber-900">Cannot be repriced automatically: {d.blocked}. Open the quotation to update it.</p> : null}
          {d.lines.length ? <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm"><thead><tr className="border-b text-xs text-neutral-500"><th className="py-2">Line</th><th>Old rate/kg</th><th>New rate/kg</th><th>Old line</th><th>New line</th></tr></thead><tbody>
            {d.lines.map(l => <tr key={l.quote_item_id} className="border-b"><td className="py-2">{l.item_label}</td><td>{inr(l.old_rate)}</td><td className="font-semibold">{inr(l.new_rate)}</td><td>{inr(l.old_line_total)}</td><td className="font-semibold">{inr(l.new_line_total)}</td></tr>)}
          </tbody></table></div> : null}
          <p className="mt-2 text-sm">Total {inr(d.old_grand_total)} → <strong>{d.new_grand_total == null ? "—" : inr(d.new_grand_total)}</strong>{d.change != null ? ` (${d.change >= 0 ? "+" : ""}${inr(d.change)})` : ""}{d.lines_without_rate ? ` · ${d.lines_without_rate} line(s) have no approved rate and are unchanged` : ""}</p>
        </article>)}</div>}
        <div className="flex flex-wrap gap-2">
          {canApply ? <Action disabled={!changing.length} run={async () => {
            const result = await write<{ state: string; message?: string; run_id?: string; quotes?: number }>("ap_reprice", "apply", { fingerprint: v.fingerprint, ...(excluded.size ? { exclude_quote_ids: [...excluded] } : {}) }, setNote, "Drafts repriced.");
            if (result?.state === "stale" || result?.state === "nothing") setNote({ tone: "error", text: result.message ?? "Review the list again." });
            else if (result?.run_id) setNote({ tone: "ok", text: `${result.quotes} draft(s) repriced. Print the impact list from the history below.` });
            setRev(x => x + 1);
          }}>Reprice {changing.length} draft(s)</Action> : <p className="text-sm text-neutral-600">An owner or admin applies the new rate to priced quotation lines.</p>}
          <button type="button" className="min-h-11 rounded-xl border border-neutral-300 bg-white px-4 text-sm font-bold" onClick={() => window.print()}>Print impact list</button>
        </div>
        {v.sent.length ? <><h3 className="pt-2 font-bold">Sent quotations: rate moved since sent</h3><p className="text-xs text-neutral-600">Listed only. Their prices do not change; requote if the customer asks.</p>
          <ul className="divide-y">{v.sent.map(s => <li key={s.quote_id} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><Link className="font-semibold underline" href={`/quotes/${s.quote_id}`}>{s.quote_number}</Link><span>{s.customer ?? ""} · valid to {fmtDay(s.valid_until)} · {inr(s.sent_rate)} → {inr(s.today_rate)} ({pct(s.change_percent)})</span></li>)}</ul></> : null}
        {v.approved_unsent.length ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{v.approved_unsent.length} quotation(s) are approved for sending at an older rate ({v.approved_unsent.map(q => q.quote_number).join(", ")}). Return them to draft to reprice; their approval was given on the old price.</p> : null}
      </> : null}
    </Section>
    <ProposalCards key={rev} initial={null} type="quote.reprice" today={v?.today ?? ""} title="Overnight repricing proposal" emptyText="No repricing proposal is waiting." />
    <RepriceHistory rev={rev} />
  </div>;
}

function RepriceHistory({ rev }: { rev: number }) {
  const [page, setPage] = useState(1);
  const read = useApRead<Queue<{ id: string; rate_day: string; quote_count: number; line_count: number; old_total: number; new_total: number; source: string; applied_at: string; applied_by: string | null }>>("ap_reprice", "runs", { page }, [rev]);
  return <Section title="Repricing history" description="Each run keeps the old and new rate and total of every line.">
    {read.error ? <Failure text={read.error} /> : read.loading && !read.data ? <Loading what="history" /> : read.data ? <>
      {!read.data.rows.length ? <Empty>No drafts have been repriced yet.</Empty> : <ul className="divide-y">{read.data.rows.map(r => <li key={r.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
        <Link className="font-semibold underline" href={`/quotes/reprice/${r.id}`}>{fmtDay(r.rate_day)} · {r.quote_count} draft(s), {r.line_count} line(s)</Link>
        <span>{inr(r.old_total)} → {inr(r.new_total)} · {r.applied_by ?? ""} · {fmtWhen(r.applied_at)}{r.source === "proposal" ? " · from proposal" : ""}</span></li>)}</ul>}
      <Pager page={page} total={read.data.total_count} onPage={setPage} />
    </> : null}
  </Section>;
}

type RunView = { run: { id: string; rate_day: string; quote_count: number; line_count: number; old_total: number; new_total: number; applied_at: string; applied_by_name: string | null };
  lines: { id: string; quote_id: string; quote_number: string; customer_name: string | null; item_label: string; old_rate: number | null; new_rate: number; old_line_total: number | null; new_line_total: number | null; old_grand_total: number | null; new_grand_total: number | null }[] };
export function RepriceRun({ id }: { id: string }) {
  const read = useApRead<RunView>("ap_reprice", "run", { id });
  const v = read.data;
  return <Section title="Repricing impact list" description="Internal: contains costs and rates. Do not send to customers." actions={<button type="button" className="min-h-11 rounded-xl border px-4 text-sm font-bold print:hidden" onClick={() => window.print()}>Print</button>}>
    {read.error ? <Failure text={read.error} /> : !v ? <Loading what="impact list" /> : <>
      <p className="text-sm">Billet rate of {fmtDay(v.run.rate_day)} · applied {fmtWhen(v.run.applied_at)} by {v.run.applied_by_name ?? "—"} · {v.run.quote_count} quotation(s), {v.run.line_count} line(s) · {inr(v.run.old_total)} → {inr(v.run.new_total)}</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead><tr className="border-b text-xs text-neutral-500"><th className="py-2">Quotation</th><th>Customer</th><th>Line</th><th>Rate/kg</th><th>Line total</th><th>Quotation total</th></tr></thead><tbody>
        {v.lines.map(l => <tr key={l.id} className="border-b"><td className="py-2">{l.quote_number}</td><td>{l.customer_name ?? ""}</td><td>{l.item_label}</td><td>{inr(l.old_rate)} → {inr(l.new_rate)}</td><td>{inr(l.old_line_total)} → {inr(l.new_line_total)}</td><td>{inr(l.old_grand_total)} → {inr(l.new_grand_total)}</td></tr>)}
      </tbody></table></div>
    </>}
  </Section>;
}
