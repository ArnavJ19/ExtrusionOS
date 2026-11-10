"use client";

// AP-046: drafts prepared at gate-out (no invoice number until posted) and the unbilled-dispatch report; AP-037: the
// place-of-supply rule accounts confirms, HSN defaults, and the audit sample of derived versus chosen states.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { postInvoiceDraftsAction, type DraftPostResult } from "@/lib/actions/order-to-cash";
import { GST_STATE_OPTIONS, fmtDay, fmtWhen, inr } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "./ui";

type Draft = { id: string; dispatch_id: string; order_id: string; status: string; blocker: string | null; dispatch_number: string | null; order_number: string | null; customer: string | null;
  gate_out_at: string; invoice_date: string; due_date: string | null; place_of_supply_state_code: string | null; supply_basis: { basis?: string; tax_type?: string | null; state_label?: string };
  goods_value: number | null; tax_value: number | null; charges_value: number | null; total_value: number | null; line_count: number | null; invoice_id: string | null; invoice_number: string | null;
  explanation: string | null; working_days_since_gate_out: number | null };
type Unbilled = { dispatch_id: string; dispatch_number: string | null; gate_out_at: string; order_id: string; order_number: string | null; customer: string | null; draft_status: string | null;
  blocker: string | null; explanation: string | null; total_value: number | null; working_days: number; late: boolean };
const stateName = (code: string | null) => GST_STATE_OPTIONS.find(([c]) => c === code)?.[1] ?? code ?? "—";

function DraftsTab() {
  const router = useRouter();
  const [status, setStatus] = useState<"open" | "blocked" | "posted" | "all">("open");
  const [page, setPage] = useState(1); const [picked, setPicked] = useState<string[]>([]);
  const [results, setResults] = useState<DraftPostResult[] | null>(null); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const { data, error, loading, reload } = useApRead<{ total_count: number; rows: Draft[]; summary: { open: number; blocked: number; open_total: number } }>("ap_billing", "drafts", { status, page });
  async function post(ids: string[]) {
    setBusy(true); setResults(null);
    const out = await postInvoiceDraftsAction(ids);
    setBusy(false);
    if (!out.success) return setMessage({ tone: "error", text: out.error });
    setResults(out.data); setPicked([]); void reload(); router.refresh();
  }
  return <Section title="Invoice drafts to post" description="Prepared automatically when a dispatch leaves the gate, from the packing list, order rates, the place of supply and the customer's credit days. The invoice number is allocated only when you post."
    actions={<select aria-label="Draft status" value={status} onChange={e => { setStatus(e.target.value as typeof status); setPage(1); setPicked([]); }} className={`${inputClass} w-36`}>
      <option value="open">Ready</option><option value="blocked">Blocked</option><option value="posted">Posted</option><option value="all">All</option></select>}>
    {data ? <p className="text-sm font-semibold">{data.summary.open} ready ({inr(data.summary.open_total)}) · {data.summary.blocked} blocked</p> : null}
    {loading && !data ? <Loading what="drafts" /> : error ? <Failure text={error} /> : !data?.rows.length ? <Empty>No drafts in this list.</Empty>
      : <ul className="space-y-2">{data.rows.map(d => <li key={d.id} className="flex flex-wrap gap-3 rounded-xl border border-neutral-200 p-3 text-sm">
        {d.status === "open" ? <input type="checkbox" aria-label={`Select ${d.dispatch_number}`} className="mt-1 h-5 w-5" checked={picked.includes(d.id)} onChange={e => setPicked(e.target.checked ? [...picked, d.id] : picked.filter(x => x !== d.id))} /> : null}
        <div className="min-w-0 flex-1">
          <p className="font-bold"><Link className="underline" href={`/dispatches/${d.dispatch_id}`}>{d.dispatch_number}</Link> · <Link className="underline" href={`/orders/${d.order_id}`}>{d.order_number}</Link> · {d.customer}</p>
          <p className="text-neutral-700">Goods {inr(d.goods_value)} + GST {inr(d.tax_value)}{Number(d.charges_value ?? 0) > 0 ? ` + charges ${inr(d.charges_value)}` : ""} = <b>{inr(d.total_value)}</b> · {d.line_count ?? 0} packed line(s)</p>
          <p className="text-neutral-600">Gate-out {fmtWhen(d.gate_out_at)} · invoice date {fmtDay(d.invoice_date)} · due {d.due_date ? fmtDay(d.due_date) : "no credit days set"} · place of supply {stateName(d.place_of_supply_state_code)}
            {d.supply_basis?.tax_type ? ` (${d.supply_basis.tax_type === "igst" ? "IGST" : "CGST + SGST"}, from ${String(d.supply_basis.basis ?? "").replaceAll("_", " ")})` : ""}</p>
          {d.blocker ? <p className="font-semibold text-rose-800">{d.blocker}</p> : null}
          {d.invoice_id ? <p><Link className="underline" href={`/invoices/${d.invoice_id}`}>{d.invoice_number ?? "Invoice"}</Link> posted</p> : null}
        </div>
        <div className="flex flex-col items-end gap-2"><Pill value={d.status} />
          {d.status === "open" ? <button type="button" disabled={busy} className={secondaryClass} onClick={() => post([d.id])}>Post</button> : null}
          {d.status !== "posted" ? <button type="button" className="text-xs underline" onClick={async () => { if (await apWrite("ap_billing", "refresh", { id: d.id }, setMessage, "Draft refreshed from the current packing list.")) void reload(); }}>Refresh</button> : null}</div>
      </li>)}</ul>}
    {picked.length ? <button type="button" disabled={busy} className={buttonClass} onClick={() => post(picked)}>{busy ? "Posting…" : `Post ${picked.length} selected invoice${picked.length === 1 ? "" : "s"}`}</button> : null}
    {results ? <ul role="status" className="space-y-1 rounded-xl bg-neutral-50 p-3 text-sm">{results.map(r => <li key={r.id}>{r.state === "posted" ? <>Posted · <Link className="underline" href={`/invoices/${r.invoice_id}`}>open invoice</Link></>
      : r.state === "changed" ? <span className="text-amber-900">{r.message}</span> : <span className="text-rose-800">Not posted: {r.message}</span>}</li>)}</ul> : null}
    {data ? <Pager page={page} total={data.total_count} onPage={setPage} /> : null}
    <Message value={message} />
  </Section>;
}

function UnbilledTab() {
  const [page, setPage] = useState(1); const [onlyLate, setOnlyLate] = useState(true);
  const [explaining, setExplaining] = useState<{ id: string; text: string } | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const { data, error, loading, reload } = useApRead<{ total_count: number; rows: Unbilled[]; summary: { late_unexplained: number; late_explained: number; total: number } }>("ap_billing", "unbilled", { page, only_late: onlyLate });
  return <Section title="Dispatched but not invoiced" description="Every dispatch that left the gate without an active invoice. Older than one working day must be invoiced or explained."
    actions={<label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={onlyLate} onChange={e => { setOnlyLate(e.target.checked); setPage(1); }} />Older than one working day</label>}>
    {data ? <p className={`text-sm font-semibold ${data.summary.late_unexplained ? "text-rose-800" : "text-emerald-800"}`}>{data.summary.late_unexplained} late without explanation · {data.summary.late_explained} explained · {data.summary.total} unbilled in all</p> : null}
    {loading && !data ? <Loading what="unbilled dispatches" /> : error ? <Failure text={error} /> : !data?.rows.length ? <Empty>Nothing unbilled in this view.</Empty>
      : <ul className="space-y-2">{data.rows.map(u => <li key={u.dispatch_id} className="rounded-xl border border-neutral-200 p-3 text-sm">
        <p className="font-bold"><Link className="underline" href={`/dispatches/${u.dispatch_id}`}>{u.dispatch_number}</Link> · {u.order_number} · {u.customer}</p>
        <p className="text-neutral-600">Gate-out {fmtWhen(u.gate_out_at)} · {u.working_days} working day(s) · draft {u.draft_status ?? "not prepared"}{u.total_value !== null ? ` · ${inr(u.total_value)}` : ""}</p>
        {u.blocker ? <p className="text-rose-800">{u.blocker}</p> : null}
        {u.explanation ? <p>Explained: {u.explanation}</p> : explaining?.id === u.dispatch_id ? <div className="mt-2 flex flex-wrap gap-2">
          <input aria-label="Why it is not invoiced yet" value={explaining.text} onChange={e => setExplaining({ id: u.dispatch_id, text: e.target.value })} className={`${inputClass} flex-1`} placeholder="For example: customer asked to bill with the next load" />
          <button type="button" className={buttonClass} onClick={async () => { if (await apWrite("ap_billing", "explain", { dispatch_id: u.dispatch_id, reason: explaining.text.trim() }, setMessage, "Explanation recorded.")) { setExplaining(null); void reload(); } }}>Save</button></div>
          : <button type="button" className="mt-1 text-sm underline" onClick={() => setExplaining({ id: u.dispatch_id, text: "" })}>Explain why it is not invoiced</button>}
      </li>)}</ul>}
    {data ? <Pager page={page} total={data.total_count} onPage={setPage} /> : null}
    <Message value={message} />
  </Section>;
}

export function InvoiceDraftsClient() {
  const [tab, setTab] = useState<"drafts" | "unbilled">("drafts");
  return <div className="space-y-4">
    <div role="tablist" className="flex gap-2">{(["drafts", "unbilled"] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)}
      className={`min-h-11 rounded-xl px-4 text-sm font-bold ${tab === t ? "bg-neutral-950 text-white" : "border border-neutral-300 bg-white"}`}>{t === "drafts" ? "Drafts to post" : "Unbilled dispatches"}</button>)}</div>
    {tab === "drafts" ? <DraftsTab /> : <UnbilledTab />}
  </div>;
}

type Rule = { rule: { version: number; hsn_profile: string | null; hsn_scrap: string | null; note: string | null; confirmed_at: string; confirmed_by: string } | null;
  supplier_state: string | null; profiles_without_hsn: number; customers_without_state: number };
type Sample = { invoice_id: string; invoice_number: string; invoice_date: string; customer: string; derived_state: string | null; chosen_state: string | null; basis: string;
  tax_type: string; expected_tax_type: string | null; override_reason: string | null };

export function GstRulesClient() {
  const rule = useApRead<Rule>("ap_billing", "gst_rule", {});
  const [form, setForm] = useState({ hsn_profile: "7604", hsn_scrap: "7602", note: "" });
  const [page, setPage] = useState(1); const [onlyMismatch, setOnlyMismatch] = useState(false);
  const sample = useApRead<{ total_count: number; rows: Sample[] }>("ap_billing", "gst_sample", { page, only_mismatch: onlyMismatch });
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const r = rule.data;
  return <div className="space-y-4">
    <Section title="Place of supply rule" description="The state comes from the first two digits of the customer's billing GSTIN (or the customer's recorded state when unregistered) and is compared with the company's GST state. Once accounts confirms the rule, a different state on an invoice needs a recorded reason.">
      {rule.error ? <Failure text={rule.error} /> : !r ? <Loading what="rule" /> : <>
        <p className="text-sm">Company GST state: <b>{stateName(r.supplier_state)}</b>{!r.supplier_state ? " — set the company GSTIN or state code in Settings first." : ""}</p>
        <p className="text-sm">{r.rule ? `Confirmed v${r.rule.version} by ${r.rule.confirmed_by} on ${fmtDay(r.rule.confirmed_at)}; profile HSN ${r.rule.hsn_profile ?? "—"}, scrap HSN ${r.rule.hsn_scrap ?? "—"}.` : "Not confirmed yet: the derived state is filled in but a different state is not refused."}</p>
        <p className="text-sm text-neutral-600">{r.profiles_without_hsn} profile(s) without an HSN code · {r.customers_without_state} customer(s) with neither a valid GSTIN nor a recognised state.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-sm font-semibold">Profile HSN<input value={form.hsn_profile} onChange={e => setForm({ ...form, hsn_profile: e.target.value })} className={`${inputClass} mt-1`} inputMode="numeric" /></label>
          <label className="text-sm font-semibold">Scrap HSN<input value={form.hsn_scrap} onChange={e => setForm({ ...form, hsn_scrap: e.target.value })} className={`${inputClass} mt-1`} inputMode="numeric" /></label>
          <label className="text-sm font-semibold">Note<input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} className={`${inputClass} mt-1`} placeholder="Confirmed with the CA" /></label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} onClick={async () => { if (await apWrite("ap_billing", "gst_confirm", { ...(form.hsn_profile ? { hsn_profile: form.hsn_profile } : {}), ...(form.hsn_scrap ? { hsn_scrap: form.hsn_scrap } : {}),
            ...(form.note.trim() ? { note: form.note.trim() } : {}) }, setMessage, "Rule confirmed. New invoices follow it.")) void rule.reload(); }}>{r.rule ? "Confirm a new version" : "Confirm the rule"}</button>
          {r.rule?.hsn_profile && r.profiles_without_hsn ? <button type="button" className={secondaryClass} onClick={async () => { const out = await apWrite<{ profiles_updated: number }>("ap_billing", "hsn_apply", {}, setMessage);
            if (out) { setMessage({ tone: "ok", text: `${out.profiles_updated} profile(s) given HSN ${r.rule?.hsn_profile}.` }); void rule.reload(); } }}>Fill blank profile HSN codes</button> : null}
        </div></>}
      <Message value={message} />
    </Section>
    <Section title="Invoice sample" description="Each invoice's derived and chosen place of supply with the tax type charged. Wrong tax type should be zero."
      actions={<label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={onlyMismatch} onChange={e => { setOnlyMismatch(e.target.checked); setPage(1); }} />Only differences</label>}>
      {sample.loading && !sample.data ? <Loading what="sample" /> : sample.error ? <Failure text={sample.error} /> : !sample.data?.rows.length ? <Empty>No invoices recorded since the rule started.</Empty>
        : <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="text-left text-neutral-500"><th className="py-1">Invoice</th><th>Customer</th><th>Derived</th><th>Chosen</th><th>Tax charged</th><th>Override reason</th></tr></thead>
          <tbody>{sample.data.rows.map(s => <tr key={s.invoice_id} className="border-t border-neutral-100"><td className="py-1"><Link className="underline" href={`/invoices/${s.invoice_id}`}>{s.invoice_number}</Link></td><td>{s.customer}</td>
            <td>{stateName(s.derived_state)}</td><td>{stateName(s.chosen_state)}</td><td className={s.expected_tax_type && s.expected_tax_type !== s.tax_type && s.derived_state === s.chosen_state ? "font-bold text-rose-800" : ""}>{s.tax_type}</td><td>{s.override_reason ?? "—"}</td></tr>)}</tbody></table></div>}
      {sample.data ? <Pager page={page} total={sample.data.total_count} onPage={setPage} /> : null}
    </Section>
  </div>;
}
