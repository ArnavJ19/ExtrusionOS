"use client";

// AP-024: upload the bank statement export; credits are matched to customers and open invoices (exact, likely, unknown).
// Accepting a match posts the receipt with oldest-first allocation (AP-058); an unknown remitter is assigned once and
// learned. A line can create at most one live receipt; reversal needs a reason.
import { useState } from "react";
import Link from "next/link";
import { importBankStatementAction, previewBankStatementAction, type BankImportResult, type BankPreview } from "@/lib/actions/order-to-cash";
import { BANK_DATE_FORMATS, type BankDateFormat, type BankMapping } from "@/lib/financials/bank-statement";
import { fmtDay, fmtWhen, inr } from "@/lib/order-to-cash/commands";
import { ProposalCards } from "@/components/modules/autopilot/proposal-cards";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "./ui";

type Line = { id: string; line_no: number; txn_date: string; narration: string; reference: string | null; amount: number; remitter: string | null; state: string; match_class: string | null;
  customer: string | null; customer_id: string | null; assigned: boolean; ignored_reason: string | null; reversal_count: number; last_reversal_reason: string | null; proposal_id: string | null };

function CustomerPicker({ onPick }: { onPick: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const { data } = useApRead<{ id: string; name: string; city: string | null }[]>("ap_cash", "customers", search.trim().length >= 2 ? { search: search.trim() } : {}, [search]);
  return <div className="space-y-1"><input aria-label="Search customer" value={search} onChange={e => setSearch(e.target.value)} placeholder="Type 2+ letters of the customer" className={inputClass} />
    <ul className="max-h-40 overflow-y-auto rounded-xl border border-neutral-200">{(data ?? []).slice(0, 8).map(c => <li key={c.id}><button type="button" onClick={() => onPick(c.id)} className="min-h-11 w-full px-3 text-left text-sm hover:bg-neutral-50">{c.name}{c.city ? ` · ${c.city}` : ""}</button></li>)}</ul></div>;
}

function Upload({ onImported }: { onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BankPreview | null>(null);
  const [mapping, setMapping] = useState<BankMapping | null>(null);
  const [format, setFormat] = useState<BankDateFormat>("DD/MM/YYYY");
  const [profileName, setProfileName] = useState(""); const [account, setAccount] = useState("");
  const [result, setResult] = useState<BankImportResult | null>(null); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const form = (extra: Record<string, string> = {}) => { const f = new FormData(); f.set("file", file!); for (const [k, v] of Object.entries(extra)) f.set(k, v); return f; };
  async function check(chosen: File) {
    setFile(chosen); setResult(null); setBusy(true);
    const f = new FormData(); f.set("file", chosen);
    const out = await previewBankStatementAction(f);
    setBusy(false);
    if (!out.success) { setPreview(null); return setMessage({ tone: "error", text: out.error }); }
    setMessage(null); setPreview(out.data); setMapping(out.data.mapping); setFormat(out.data.dateFormat); setProfileName(out.data.remembered ?? "");
  }
  async function run() {
    if (!file || !mapping) return;
    setBusy(true);
    const out = await importBankStatementAction(form({ mapping: JSON.stringify(mapping), dateFormat: format, ...(profileName.trim().length >= 3 ? { profileName: profileName.trim() } : {}), ...(account.trim() ? { accountLabel: account.trim() } : {}) }));
    setBusy(false);
    if (!out.success) return setMessage({ tone: "error", text: out.error });
    setResult(out.data); setPreview(null); onImported();
  }
  const column = (key: keyof BankMapping, label: string, optional = false) => <label className="text-sm font-semibold">{label}
    <select value={mapping?.[key] ?? ""} onChange={e => setMapping({ ...mapping!, [key]: e.target.value === "" ? null : Number(e.target.value) })} className={`${inputClass} mt-1`}>
      {optional ? <option value="">Not in this file</option> : null}{preview!.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}</select></label>;
  return <Section title="Import a bank statement" description="Export the statement from net banking as Excel or CSV. The same file, or lines already imported from an earlier file, are not imported twice.">
    <input type="file" accept=".csv,.xlsx" aria-label="Bank statement file" onChange={e => { const chosen = e.target.files?.[0]; if (chosen) void check(chosen); }} className="text-sm" />
    {busy ? <Loading what="statement" /> : null}
    {preview && mapping ? <div className="space-y-3">
      <p className="text-sm">{preview.rowCount} readable row(s), {preview.credits} credit(s){preview.errors.length ? `, ${preview.errors.length} unreadable` : ""}.{preview.remembered ? ` Using the saved "${preview.remembered}" columns.` : ""}</p>
      <div className="grid gap-2 sm:grid-cols-3">{column("date", "Date")}{column("narration", "Narration")}{column("reference", "Reference / UTR", true)}{column("credit", "Credit / deposit", true)}{column("debit", "Debit / withdrawal", true)}
        {mapping.credit === null ? column("amount", "Single amount column", true) : null}{mapping.credit === null ? column("drcr", "Dr/Cr column", true) : null}
        <label className="text-sm font-semibold">Date format<select value={format} onChange={e => setFormat(e.target.value as BankDateFormat)} className={`${inputClass} mt-1`}>{BANK_DATE_FORMATS.map(f => <option key={f}>{f}</option>)}</select></label>
        <label className="text-sm font-semibold">Remember as (bank name)<input value={profileName} onChange={e => setProfileName(e.target.value)} className={`${inputClass} mt-1`} placeholder="HDFC current account" /></label>
        <label className="text-sm font-semibold">Account label<input value={account} onChange={e => setAccount(e.target.value)} className={`${inputClass} mt-1`} placeholder="HDFC ...4521" /></label></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead><tr className="text-left text-neutral-500"><th>Date</th><th>Narration</th><th>Reference</th><th className="text-right">Credit</th><th className="text-right">Debit</th></tr></thead>
        <tbody>{preview.sample.map(r => <tr key={r.line_no} className="border-t border-neutral-100"><td>{fmtDay(r.txn_date)}</td><td className="max-w-xs truncate">{r.narration}</td><td>{r.reference ?? "—"}</td><td className="text-right">{r.credit ? inr(r.credit) : ""}</td><td className="text-right">{r.debit ? inr(r.debit) : ""}</td></tr>)}</tbody></table></div>
      {preview.errors.length ? <ul className="text-xs text-rose-800">{preview.errors.map(e => <li key={e.line_no}>Row {e.line_no}: {e.error}</li>)}</ul> : null}
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={run} className={buttonClass}>Import and match</button><button type="button" onClick={() => file && check(file)} className={secondaryClass}>Re-read with these columns</button></div>
    </div> : null}
    {result ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{result.already_imported ? "This file was imported before; nothing changed."
      : `${result.new_lines} new line(s), ${result.duplicates} already imported. Credits: ${result.exact} exact, ${result.likely} likely, ${result.unknown} to assign.${(result.errors?.length ?? 0) + result.file_errors.length ? ` ${(result.errors?.length ?? 0) + result.file_errors.length} row(s) could not be read.` : ""}`}</p> : null}
    <Message value={message} />
  </Section>;
}

function LineActions({ line, onChanged }: { line: Line; onChanged: () => void }) {
  const [mode, setMode] = useState<"assign" | "ignore" | "reverse" | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2 text-sm">
      {line.state !== "receipted" ? <button type="button" className="underline" onClick={() => setMode(mode === "assign" ? null : "assign")}>{line.customer_id ? "Change customer" : "Assign customer"}</button> : null}
      {line.state !== "receipted" && line.state !== "ignored" ? <button type="button" className="underline" onClick={() => setMode(mode === "ignore" ? null : "ignore")}>Not a customer receipt</button> : null}
      {line.state === "ignored" ? <button type="button" className="underline" onClick={async () => { if (await apWrite("ap_cash", "bank_rematch", { line_id: line.id }, setMessage, "Back in the list.")) onChanged(); }}>Undo ignore</button> : null}
      {line.state === "receipted" ? <button type="button" className="underline" onClick={() => setMode(mode === "reverse" ? null : "reverse")}>Reverse receipt</button> : null}
    </div>
    {mode === "assign" ? <CustomerPicker onPick={async id => { const out = await apWrite<{ learned_remitter: string | null }>("ap_cash", "bank_assign", { line_id: line.id, customer_id: id }, setMessage);
      if (out) { setMessage({ tone: "ok", text: out.learned_remitter ? `Assigned; "${out.learned_remitter}" will be recognised next time.` : "Assigned." }); setMode(null); onChanged(); } }} /> : null}
    {mode === "ignore" || mode === "reverse" ? <div className="flex flex-wrap gap-2"><input aria-label="Reason" value={reason} onChange={e => setReason(e.target.value)} className={`${inputClass} flex-1`} placeholder={mode === "ignore" ? "For example: interest credit" : "Why the receipt is wrong (10+ characters)"} />
      <button type="button" className={buttonClass} onClick={async () => { if (await apWrite("ap_cash", mode === "ignore" ? "bank_ignore" : "bank_reverse", { line_id: line.id, reason: reason.trim() }, setMessage, mode === "ignore" ? "Marked as not a customer receipt." : "Receipt reversed; the line is back to be matched.")) { setMode(null); setReason(""); onChanged(); } }}>{mode === "ignore" ? "Ignore" : "Reverse"}</button></div> : null}
    <Message value={message} />
  </div>;
}

export function BankClient({ today }: { today: string }) {
  const [state, setState] = useState<"waiting" | "receipted" | "ignored" | "all">("waiting");
  const [page, setPage] = useState(1); const [search, setSearch] = useState(""); const [reloadKey, setReloadKey] = useState(0);
  const lines = useApRead<{ total_count: number; rows: Line[] }>("ap_cash", "bank_lines", { state, page, ...(search.trim() ? { search: search.trim() } : {}) }, [reloadKey]);
  const rate = useApRead<{ month: string; credits: number; without_search: number; percent_without_search: number | null; target_percent: number }>("ap_cash", "bank_rate", {}, [reloadKey]);
  const statements = useApRead<{ total_count: number; rows: Array<{ id: string; source_name: string; period_from: string | null; period_to: string | null; new_lines: number; duplicate_lines: number; receipted: number; waiting: number; imported_at: string }> }>("ap_cash", "bank_statements", { page: 1 }, [reloadKey]);
  const refresh = () => { setReloadKey(k => k + 1); };
  return <div className="space-y-4">
    {rate.data ? <p className="text-sm font-semibold">{rate.data.month}: {rate.data.without_search} of {rate.data.credits} credits receipted without manual search ({rate.data.percent_without_search ?? 0}%; target {rate.data.target_percent}%).</p> : null}
    <Upload onImported={refresh} />
    <ProposalCards type="bank.receipt_match" initial={null} today={today} title="Matches to confirm" description="Exact matches can be accepted in a batch; check likely ones. Accepting posts the receipt and keeps any excess on account." reloadKey={reloadKey} onDecided={refresh}
      emptyText="No matches waiting." />
    <Section title="Bank credits" actions={<div className="flex flex-wrap gap-2"><input aria-label="Search lines" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Narration, UTR or amount" className={`${inputClass} w-48`} />
      <select aria-label="Line state" value={state} onChange={e => { setState(e.target.value as typeof state); setPage(1); }} className={`${inputClass} w-36`}><option value="waiting">Waiting</option><option value="receipted">Receipted</option><option value="ignored">Ignored</option><option value="all">All</option></select></div>}>
      {lines.loading && !lines.data ? <Loading what="bank lines" /> : lines.error ? <Failure text={lines.error} /> : !lines.data?.rows.length ? <Empty>No bank credits in this list.</Empty>
        : <ul className="space-y-2">{lines.data.rows.map(l => <li key={l.id} className="space-y-1 rounded-xl border border-neutral-200 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-bold">{inr(l.amount)} · {fmtDay(l.txn_date)}</span><span className="flex gap-1">{l.match_class ? <Pill value={l.match_class} /> : null}<Pill value={l.state} /></span></div>
          <p className="break-words text-neutral-700">{l.narration}{l.reference ? ` · ${l.reference}` : ""}</p>
          <p className="text-neutral-600">{l.customer ? `Customer: ${l.customer}${l.assigned ? " (assigned)" : ""}` : `Remitter: ${l.remitter ?? "not readable"}`}{l.ignored_reason ? ` · ${l.ignored_reason}` : ""}{l.reversal_count ? ` · reversed ${l.reversal_count}×: ${l.last_reversal_reason}` : ""}</p>
          {l.proposal_id ? <a className="underline" href={`#proposal-${l.proposal_id}`}>Review the match above</a> : null}
          <LineActions line={l} onChanged={refresh} />
        </li>)}</ul>}
      {lines.data ? <Pager page={page} total={lines.data.total_count} onPage={setPage} /> : null}
    </Section>
    <Section title="Imported statements">
      {statements.data?.rows.length ? <ul className="space-y-1 text-sm">{statements.data.rows.map(s => <li key={s.id}>{s.source_name} · {fmtDay(s.period_from)}–{fmtDay(s.period_to)} · {s.new_lines} new, {s.duplicate_lines} repeated · {s.receipted} receipted, {s.waiting} waiting · {fmtWhen(s.imported_at)}</li>)}</ul>
        : <Empty>No statement imported yet.</Empty>}
      <Link href="/payments/receipts" className="text-sm underline">Record a receipt by hand</Link>
    </Section>
  </div>;
}
