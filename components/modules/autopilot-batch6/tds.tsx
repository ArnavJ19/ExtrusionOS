"use client";

import { useState } from "react";
import Link from "next/link";
import { importTdsStatementAction } from "@/lib/actions/autopilot-batch6";
import { fmtDay, fmtWhen, inr } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, inputClass, useApRead } from "../order-to-cash/ui";
import { Action, Field, NumberInput, optional, write, type Note, type Queue } from "./shared";

type Settings = { configured: boolean; sections?: string[]; default_section?: string; default_rate_percent?: number | null; basis?: "taxable" | "gross"; tolerance_inr?: number; note: string };
type OpenInvoice = { invoice_id: string; invoice_number: string; invoice_date: string; subtotal: number; grand_total: number; balance_due: number; tds_recorded: number; suggested_tds: number | null };
type Likely = { invoice_id: string; invoice_number: string; invoice_date: string; customer_id: string; customer: string | null; balance_due: number; amount_paid: number; expected_tds: number };
type Register = { customer_id: string; customer: string | null; tan: string | null; fy: string; quarter: number; recorded: number; statement: number; difference: number; state: string; unmatched_recorded: number; unmatched_statement: number };
const STATE: Record<string, string> = { matched: "Matched", not_in_statement: "Not in statement yet", short_in_statement: "Statement shows less", not_recorded: "Statement shows TDS not recorded" };

export function TdsClient({ today, customers }: { today: string; customers: { id: string; name: string }[] }) {
  const [rev, setRev] = useState(0); const [customer, setCustomer] = useState<string>("");
  const settings = useApRead<Settings>("ap_tds", "settings", {}, [rev]);
  return <div className="space-y-5">
    <LikelyTds rev={rev} onPick={id => setCustomer(id)} />
    <Section title="Record TDS deducted by a customer" description="Settles the invoice through the normal receipt writer and keeps a TDS register by customer and quarter.">
      <div className="max-w-md"><Field label="Customer"><select className={inputClass} value={customer} onChange={e => setCustomer(e.target.value)}><option value="">Choose a customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field></div>
      {customer && settings.data ? <RecordTds key={customer} customerId={customer} today={today} settings={settings.data} onSaved={() => setRev(v => v + 1)} /> : null}
      {customer ? <CustomerTan key={`tan:${customer}`} customerId={customer} /> : null}
    </Section>
    <TdsRegister rev={rev} />
    <StatementImport onImported={() => setRev(v => v + 1)} />
    <TdsSettings settings={settings.data} onSaved={() => setRev(v => v + 1)} />
  </div>;
}

function LikelyTds({ rev, onPick }: { rev: number; onPick: (customer: string) => void }) {
  const [page, setPage] = useState(1);
  const read = useApRead<Queue<Likely> & { configured: boolean; basis?: string }>("ap_tds", "likely", { page }, [rev]);
  return <Section title="Invoices open only by TDS" description="Part-paid invoices whose balance equals the configured TDS. Recording the TDS closes them.">
    {read.error ? <Failure text={read.error} /> : read.loading && !read.data ? <Loading what="invoices" /> : read.data ? !read.data.configured ? <Empty>Accounts has not set a default TDS section and rate yet.</Empty> : <>
      <p className="text-xs text-neutral-600">{read.data.basis}</p>
      {!read.data.rows.length ? <Empty>No invoice is open only because of unrecorded TDS.</Empty> : <ul className="divide-y">{read.data.rows.map(r => <li key={r.invoice_id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
        <span><Link className="font-semibold underline" href={`/invoices/${r.invoice_id}`}>{r.invoice_number}</Link> · {r.customer ?? ""} · balance {inr(r.balance_due)} · expected TDS {inr(r.expected_tds)}</span>
        <button type="button" className="min-h-11 rounded-xl border px-3 text-sm font-bold" onClick={() => onPick(r.customer_id)}>Record for this customer</button></li>)}</ul>}
      <Pager page={page} total={read.data.total_count} onPage={setPage} />
    </> : null}
  </Section>;
}

function RecordTds({ customerId, today, settings, onSaved }: { customerId: string; today: string; settings: Settings; onSaved: () => void }) {
  const read = useApRead<{ rows: OpenInvoice[] }>("ap_tds", "open_invoices", { customer_id: customerId });
  const [amounts, setAmounts] = useState<Record<string, string>>({}); const [day, setDay] = useState(today); const [section, setSection] = useState(settings.default_section ?? "");
  const [cert, setCert] = useState(""); const [note, setNote] = useState<Note>(null); const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  if (!settings.configured) return <Empty>Set the TDS sections below before recording.</Empty>;
  const lines = Object.entries(amounts).filter(([, v]) => optional(v) !== undefined && Number(v) > 0).map(([invoice_id, v]) => ({ invoice_id, amount: Number(v) }));
  return <div className="space-y-3">
    {read.error ? <Failure text={read.error} /> : !read.data ? <Loading what="open invoices" /> : !read.data.rows.length ? <Empty>This customer has no open invoices.</Empty> : <>
      <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr className="border-b text-xs text-neutral-500"><th className="py-2">Invoice</th><th>Taxable</th><th>Balance</th><th>Suggested TDS</th><th>TDS deducted (₹)</th></tr></thead><tbody>
        {read.data.rows.map(r => <tr key={r.invoice_id} className="border-b"><td className="py-2">{r.invoice_number}<span className="block text-xs text-neutral-500">{fmtDay(r.invoice_date)}</span></td><td>{inr(r.subtotal)}</td><td>{inr(r.balance_due)}</td>
          <td>{r.suggested_tds == null ? "—" : <button type="button" className="underline" onClick={() => setAmounts(a => ({ ...a, [r.invoice_id]: String(Math.min(r.suggested_tds!, r.balance_due)) }))}>{inr(r.suggested_tds)}</button>}</td>
          <td className="w-36"><NumberInput value={amounts[r.invoice_id] ?? ""} onChange={v => setAmounts(a => ({ ...a, [r.invoice_id]: v }))} /></td></tr>)}
      </tbody></table></div>
      <div className="grid gap-3 sm:grid-cols-3"><Field label="Deducted on"><input type="date" max={today} className={inputClass} value={day} onChange={e => setDay(e.target.value)} /></Field>
        <Field label="Section"><select className={inputClass} value={section} onChange={e => setSection(e.target.value)}>{(settings.sections ?? []).map(s => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Certificate (Form 16A) reference"><input className={inputClass} value={cert} maxLength={60} onChange={e => setCert(e.target.value)} /></Field></div>
      <p className="text-xs text-neutral-600">Suggested amounts use the rate accounts configured ({settings.default_rate_percent ?? "—"}% on {settings.basis} value). Enter what the customer actually deducted.</p>
      <Action disabled={!lines.length} run={async () => {
        const data = await write<{ fy: string; quarter: number }>("ap_tds", "record", { request_id: requestId, customer_id: customerId, deducted_on: day, section, ...(cert.trim().length >= 3 ? { certificate_ref: cert.trim() } : {}), lines }, setNote, "TDS recorded.");
        if (data) { setNote({ tone: "ok", text: `TDS recorded for FY ${data.fy} Q${data.quarter}. The invoices are settled through the receipt ledger.` }); setRequestId(crypto.randomUUID()); setAmounts({}); await read.reload(); onSaved(); }
      }}>Record TDS on {lines.length} invoice(s)</Action>
    </>}
    <Message value={note} />
  </div>;
}

function CustomerTan({ customerId }: { customerId: string }) {
  const read = useApRead<{ tan?: string | null; pan?: string | null }>("ap_tds", "customer_tax", { customer_id: customerId });
  const [tan, setTan] = useState<string | null>(null); const [note, setNote] = useState<Note>(null);
  return <div className="rounded-xl border p-3"><div className="flex flex-wrap items-end gap-2"><div className="w-56"><Field label="Customer TAN" hint="Matches the tax credit statement to this customer"><input className={inputClass} value={tan ?? read.data?.tan ?? ""} maxLength={10} onChange={e => setTan(e.target.value.toUpperCase())} /></Field></div>
    <Action secondary run={async () => { await write("ap_tds", "save_customer_tax", { customer_id: customerId, tan: (tan ?? read.data?.tan ?? "").trim() }, setNote, "TAN saved."); }}>Save TAN</Action></div><Message value={note} /></div>;
}

function TdsRegister({ rev }: { rev: number }) {
  const [page, setPage] = useState(1); const [show, setShow] = useState("all");
  const read = useApRead<Queue<Register> & { unknown_tan_lines: number }>("ap_tds", "register", { page, show }, [rev]);
  return <Section title="TDS register by customer and quarter" description="Recorded deductions against the imported tax credit statement.">
    <div className="max-w-xs"><Field label="Show"><select className={inputClass} value={show} onChange={e => { setShow(e.target.value); setPage(1); }}><option value="all">All</option><option value="attention">Differences only</option></select></Field></div>
    {read.error ? <Failure text={read.error} /> : read.loading && !read.data ? <Loading what="register" /> : read.data ? <>
      {read.data.unknown_tan_lines ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{read.data.unknown_tan_lines} statement line(s) have a TAN not linked to any customer. Save the customer&apos;s TAN to match them.</p> : null}
      {!read.data.rows.length ? <Empty>No TDS recorded or imported yet.</Empty> : <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead><tr className="border-b text-xs text-neutral-500"><th className="py-2">Customer</th><th>Quarter</th><th>Recorded</th><th>Statement</th><th>Difference</th><th>State</th></tr></thead><tbody>
        {read.data.rows.map(r => <tr key={`${r.customer_id}:${r.fy}:${r.quarter}`} className="border-b"><td className="py-2">{r.customer ?? ""}<span className="block text-xs text-neutral-500">{r.tan ?? "TAN not recorded"}</span></td><td>FY {r.fy} Q{r.quarter}</td>
          <td>{inr(r.recorded)}</td><td>{inr(r.statement)}</td><td className={Math.abs(r.difference) > 1 ? "font-bold text-rose-700" : ""}>{inr(r.difference)}</td><td><Pill value={r.state === "matched" ? "approved" : "pending"} label={STATE[r.state] ?? r.state} /></td></tr>)}
      </tbody></table></div>}
      <Pager page={page} total={read.data.total_count} onPage={setPage} />
    </> : null}
  </Section>;
}

function StatementImport({ onImported }: { onImported: () => void }) {
  const [note, setNote] = useState<Note>(null); const [problems, setProblems] = useState<{ row: number; message: string }[]>([]);
  const imports = useApRead<Queue<{ id: string; file_name: string; row_count: number; unmatched_tan: number; imported_at: string; imported_by: string | null }>>("ap_tds", "imports", { page: 1 }, [note?.text]);
  return <Section title="Import the tax credit statement" description="Form 26AS or AIS TDS details as CSV. Rows are matched by deductor TAN, quarter and amount; the original file is kept.">
    <input type="file" accept=".csv,text/csv" aria-label="Statement CSV file" className="block w-full text-sm" onChange={async e => {
      const file = e.target.files?.[0]; if (!file) return;
      const result = await importTdsStatementAction({ fileName: file.name, text: await file.text() });
      e.target.value = "";
      if (!result.success) { setNote({ tone: "error", text: result.error }); return; }
      setProblems(result.data.problems);
      setNote({ tone: result.data.rows ? "ok" : "error", text: result.data.rows ? `${result.data.rows} row(s) imported, ${result.data.matched} matched, ${result.data.unknown_tan} with an unknown TAN.` : "No readable rows were found." });
      onImported();
    }} />
    <Message value={note} />
    {problems.length ? <ul className="list-disc pl-5 text-sm text-amber-900">{problems.slice(0, 20).map(p => <li key={`${p.row}:${p.message}`}>Row {p.row}: {p.message}</li>)}</ul> : null}
    {imports.data?.rows.length ? <ul className="divide-y text-sm">{imports.data.rows.map(i => <li key={i.id} className="py-2">{i.file_name} · {i.row_count} row(s) · {i.unmatched_tan} unknown TAN · {i.imported_by ?? ""} {fmtWhen(i.imported_at)}</li>)}</ul> : null}
  </Section>;
}

function TdsSettings({ settings, onSaved }: { settings: Settings | null; onSaved: () => void }) {
  const [sections, setSections] = useState<string | null>(null); const [def, setDef] = useState<string | null>(null); const [rate, setRate] = useState<string | null>(null);
  const [basis, setBasis] = useState<string | null>(null); const [tol, setTol] = useState<string | null>(null); const [note, setNote] = useState<Note>(null);
  if (!settings) return null;
  const list = (sections ?? (settings.sections ?? ["194Q"]).join(", ")).split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
  return <Section title="TDS rules" description={settings.note}>
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Sections" hint="Comma separated, for example 194Q, 194C"><input className={inputClass} value={sections ?? (settings.sections ?? ["194Q"]).join(", ")} onChange={e => setSections(e.target.value)} /></Field>
      <Field label="Default section"><input className={inputClass} value={def ?? settings.default_section ?? "194Q"} onChange={e => setDef(e.target.value.toUpperCase())} /></Field>
      <Field label="Default rate (%)" hint="Used only to suggest amounts"><NumberInput value={rate ?? (settings.default_rate_percent == null ? "" : String(settings.default_rate_percent))} onChange={setRate} /></Field>
      <Field label="Rate applies to"><select className={inputClass} value={basis ?? settings.basis ?? "taxable"} onChange={e => setBasis(e.target.value)}><option value="taxable">Taxable value</option><option value="gross">Invoice total</option></select></Field>
      <Field label="Matching tolerance (₹)"><NumberInput value={tol ?? String(settings.tolerance_inr ?? 1)} onChange={setTol} /></Field></div>
    <Message value={note} />
    <Action run={async () => { const r = optional(rate ?? (settings.default_rate_percent == null ? "" : String(settings.default_rate_percent)));
      if (await write("ap_tds", "save_settings", { sections: list, default_section: (def ?? settings.default_section ?? "194Q").trim(), ...(r !== undefined ? { default_rate_percent: r } : {}),
        basis: basis ?? settings.basis ?? "taxable", tolerance_inr: Number(tol ?? settings.tolerance_inr ?? 1) }, setNote, "TDS rules saved.")) onSaved(); }}>Save TDS rules</Action>
  </Section>;
}
