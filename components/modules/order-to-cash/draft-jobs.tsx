"use client";

// AP-045: confirmed orders become draft jobs grouped by die, alloy and temper. A draft reserves no billet or capacity; the
// planner releases it, which creates planned jobs (one per order line) through the normal job save.
import { useState } from "react";
import Link from "next/link";
import { fmtDay } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "./ui";

type Summary = { id: string; status: string; die_number: string | null; profile: string; alloy: string | null; temper: string | null; open_lines: number; open_kg: number;
  earliest_due: string | null; orders: string[]; held_orders: number };
type Line = { id: string; order_id: string; order_number: string | null; customer: string | null; line: string | null; required_kg: number; pieces: number | null; length_m: number | null;
  due_date: string | null; status: string; note: string | null; job_id: string | null; job_number: string | null; credit_hold: string | null; current_need_kg: number | null };
type Detail = Summary & { lines: Line[]; can_release: boolean; presses: { id: string; name: string }[] };
type ReleaseResult = { released: { order: string; job_number: string; kg: number }[]; skipped: { order: string; reason: string }[] };
const kg = (v: unknown) => `${Number(v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg`;

function DraftDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { data, error, loading, reload } = useApRead<Detail>("ap_jobdrafts", "draft", { id });
  const [press, setPress] = useState(""); const [date, setDate] = useState("");
  const [picked, setPicked] = useState<string[] | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [result, setResult] = useState<ReleaseResult | null>(null);
  if (loading && !data) return <Loading what="draft" />;
  if (error) return <Failure text={error} />;
  if (!data) return null;
  const open = data.lines.filter(l => l.status === "open");
  const selected = picked ?? open.map(l => l.id);
  async function release() {
    const out = await apWrite<ReleaseResult>("ap_jobdrafts", "release", { id, ...(press ? { machine_id: press } : {}), ...(date ? { planned_date: date } : {}),
      ...(picked ? { line_ids: selected } : {}) }, setMessage);
    if (out) { setResult(out); setMessage(null); setPicked(null); void reload(); onChanged(); }
  }
  return <div className="space-y-3 rounded-xl bg-neutral-50 p-3">
    <ul className="space-y-2">{data.lines.map(l => <li key={l.id} className="flex flex-wrap items-start gap-2 rounded-lg bg-white p-2 text-sm">
      {l.status === "open" && data.can_release ? <input type="checkbox" aria-label={`Release ${l.order_number}`} checked={selected.includes(l.id)} className="mt-1 h-5 w-5"
        onChange={e => setPicked(e.target.checked ? [...selected, l.id] : selected.filter(x => x !== l.id))} /> : null}
      <div className="min-w-0 flex-1"><Link href={`/orders/${l.order_id}`} className="font-bold underline">{l.order_number}</Link> · {l.customer} · {l.line}
        <p className="text-neutral-600">{kg(l.required_kg)}{l.pieces ? ` · ${l.pieces} pcs` : ""}{l.length_m ? ` × ${l.length_m} m` : ""} · due {fmtDay(l.due_date)}
          {l.status === "open" && l.current_need_kg !== null && Math.abs(l.current_need_kg - l.required_kg) > 0.001 ? ` · now needs ${kg(l.current_need_kg)} (stock or jobs changed)` : ""}</p>
        {l.credit_hold && l.credit_hold !== "approved" ? <p className="font-semibold text-amber-900">Order on credit hold: released only after credit is approved.</p> : null}
        {l.note ? <p className="text-neutral-500">{l.note}</p> : null}</div>
      <Pill value={l.status} />{l.job_id ? <Link className="text-sm underline" href={`/production/${l.job_id}`}>{l.job_number}</Link> : null}
    </li>)}</ul>
    {data.can_release && open.length ? <div className="grid gap-2 sm:grid-cols-3">
      <label className="text-sm font-semibold">Press (optional)<select value={press} onChange={e => setPress(e.target.value)} className={`${inputClass} mt-1`}><option value="">Decide later</option>{data.presses.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="text-sm font-semibold">Planned date (optional)<input type="date" value={date} onChange={e => setDate(e.target.value)} className={`${inputClass} mt-1`} /></label>
      <div className="flex items-end"><button type="button" disabled={!selected.length} onClick={release} className={`${buttonClass} w-full`}>Release {selected.length} line{selected.length === 1 ? "" : "s"} as planned jobs</button></div>
    </div> : null}
    {result ? <div role="status" className="rounded-xl bg-white p-3 text-sm">
      {result.released.map(r => <p key={r.job_number}>Created {r.job_number} for {r.order} ({kg(r.kg)}).</p>)}
      {result.skipped.map(s => <p key={s.order + s.reason} className="text-amber-900">Skipped {s.order}: {s.reason}</p>)}
      {!result.released.length && !result.skipped.length ? <p>Nothing to release.</p> : null}</div> : null}
    <Message value={message} />
  </div>;
}

export function DraftJobsClient() {
  const [page, setPage] = useState(1); const [search, setSearch] = useState(""); const [openId, setOpenId] = useState<string | null>(null);
  const { data, error, loading, reload } = useApRead<{ total_count: number; rows: Summary[]; can_release: boolean }>("ap_jobdrafts", "list", { page, ...(search.trim() ? { search: search.trim() } : {}) });
  const stats = useApRead<{ jobs_total: number; jobs_from_drafts: number; open_lines: number }>("ap_jobdrafts", "stats", {});
  return <div className="space-y-4">
    {stats.data ? <p className="text-sm text-neutral-700">Last 30 days: {stats.data.jobs_from_drafts} of {stats.data.jobs_total} jobs came from drafts; {stats.data.open_lines} draft line(s) waiting.</p> : null}
    <Section title="Draft jobs from confirmed orders" description="Grouped by die, alloy and temper so one die setup serves several orders. Release creates planned jobs; nothing is reserved before that."
      actions={<input aria-label="Search drafts" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Order or profile" className={`${inputClass} w-48`} />}>
      {loading && !data ? <Loading what="drafts" /> : error ? <Failure text={error} /> : !data?.rows.length ? <Empty>No open drafts. New confirmed orders appear here automatically.</Empty>
        : <ul className="space-y-2">{data.rows.map(d => <li key={d.id} className="rounded-xl border border-neutral-200 p-3">
          <button type="button" onClick={() => setOpenId(openId === d.id ? null : d.id)} className="flex w-full flex-wrap items-center justify-between gap-2 text-left" aria-expanded={openId === d.id}>
            <span className="min-w-0"><span className="font-bold">{d.die_number ? `Die ${d.die_number}` : "Die to choose"}</span> · {d.profile} · {d.alloy ?? "—"} {d.temper ?? ""}
              <span className="block text-sm text-neutral-600">{d.open_lines} line(s) · {kg(d.open_kg)} · earliest due {fmtDay(d.earliest_due)} · {d.orders.join(", ")}{d.held_orders ? ` · ${d.held_orders} on credit hold` : ""}</span></span>
            <span className="text-sm font-semibold underline">{openId === d.id ? "Close" : "Review"}</span>
          </button>
          {openId === d.id ? <div className="mt-2"><DraftDetail id={d.id} onChanged={() => void reload()} /></div> : null}
        </li>)}</ul>}
      {data ? <Pager page={page} total={data.total_count} onPage={setPage} /> : null}
    </Section>
  </div>;
}

export function OrderDraftJobsPanel({ orderId }: { orderId: string }) {
  const { data, error, loading, reload } = useApRead<{ lines: Line[]; can_prepare: boolean }>("ap_jobdrafts", "order", { order_id: orderId });
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  if (loading && !data) return <Loading what="draft jobs" />;
  if (error) return null;
  if (!data) return null;
  return <Section id="draft-jobs" title="Production drafts" description="Prepared when the order was confirmed: what still needs the press after stock and existing jobs.">
    {data.lines.length ? <ul className="space-y-1 text-sm">{data.lines.map(l => <li key={l.id} className="flex flex-wrap items-center gap-2">{l.line} · {kg(l.required_kg)} <Pill value={l.status} />
      {l.job_id ? <Link className="underline" href={`/production/${l.job_id}`}>{l.job_number}</Link> : l.status === "open" ? <Link className="underline" href="/production/drafts">Release in production</Link> : null}</li>)}</ul>
      : <Empty>No draft lines: the order is covered by stock or dealer stock, or it was created before drafts existed.</Empty>}
    {data.can_prepare ? <button type="button" className={secondaryClass} onClick={async () => { const out = await apWrite<{ lines_added: number }>("ap_jobdrafts", "prepare", { order_id: orderId }, setMessage);
      if (out) { setMessage({ tone: "ok", text: out.lines_added ? `${out.lines_added} draft line(s) added.` : "Nothing more needs production." }); void reload(); } }}>Prepare drafts again</button> : null}
    <Message value={message} />
  </Section>;
}
