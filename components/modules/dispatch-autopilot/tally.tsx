"use client";

// AP-083: export vouchers to Tally. Map the ledgers once; each day download the import XML for the posted vouchers not
// yet exported. A voucher is exported once; sending it again needs an explicit re-export with a reason.
import { useState } from "react";
import { Download } from "lucide-react";
import { exportTallyAction, type TallyExportResult } from "@/lib/actions/dispatch-autopilot";
import { TALLY_LEDGER_KINDS, TALLY_VOUCHER_LABELS, type TallyLedgerKind, type TallyVoucherKind } from "@/lib/integrations/tally-xml";
import { fmtDay, fmtWhen, inr } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";

type Note = { tone: "ok" | "error"; text: string } | null;
type Mapping = { id: string; kind: TallyLedgerKind; entity_id: string | null; entity: string | null; gst_rate: number | null; supply: string | null; ledger_name: string; updated_by: string; updated_at: string };
type Pending = { kind: TallyVoucherKind; id: string; number: string; date: string; amount: number; party: string | null; exported_at: string | null };

const ist = (offset = 0) => { const d = new Date(Date.now() + 5.5 * 3600e3); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/xml" }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TallyClient() {
  const [key, setKey] = useState(0);
  const [from, setFrom] = useState(ist(-1)); const [to, setTo] = useState(ist(-1)); const [page, setPage] = useState(1); const [bPage, setBPage] = useState(1);
  const [show, setShow] = useState<"pending" | "all">("pending");
  const mappings = useApRead<{ rows: Mapping[] }>("ap_tally", "mappings", {}, [key]);
  const pending = useApRead<{ rows: Pending[]; total_count: number; pending_by_kind: Record<string, number> | null }>("ap_tally", "pending", { from, to, page, show }, [key]);
  const batches = useApRead<{ rows: Array<{ id: string; from: string; to: string; vouchers: number; generated_at: string; generated_by: string; re_exports: number; superseded: number }>; total_count: number }>("ap_tally", "batches", { page: bPage }, [key]);
  const [form, setForm] = useState({ kind: "sales" as TallyLedgerKind, gst_rate: "", supply: "", ledger_name: "" });
  const [result, setResult] = useState<TallyExportResult | null>(null);
  const [reExport, setReExport] = useState<{ row: Pending; reason: string } | null>(null);
  const [message, setMessage] = useState<Note>(null);
  const [busy, setBusy] = useState(false);
  async function exportNow() {
    setBusy(true); setMessage(null); setResult(null);
    const r = await exportTallyAction({ from, to });
    setBusy(false);
    if (!r.success) { setMessage({ tone: "error", text: r.error }); return; }
    setResult(r.data);
    if (r.data.xml) { download(r.data.filename, r.data.xml); setMessage({ tone: "ok", text: `${r.data.exported} voucher(s) in the file. Import it in Tally: Gateway → Import Data → Vouchers.` }); setKey(k => k + 1); }
    else setMessage({ tone: "error", text: r.data.issues.length ? "No voucher could be exported; map the ledgers listed below." : "Nothing new to export for these dates." });
  }
  const counts = pending.data?.pending_by_kind ?? {};
  return <div className="space-y-4">
    <Section title="Export a day's vouchers" description="Posted sales invoices, receipts, on-account money, purchase bills and credit notes not yet exported. Opening (cut-over) invoices are never exported.">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm font-semibold">From<input type="date" className={`${inputClass} mt-1 w-40`} value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label>
        <label className="text-sm font-semibold">To<input type="date" className={`${inputClass} mt-1 w-40`} value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></label>
        <button type="button" disabled={busy} className={`${buttonClass} inline-flex items-center gap-2`} onClick={exportNow}><Download className="h-4 w-4" aria-hidden="true" />Download Tally XML</button>
      </div>
      <p className="text-sm">{Object.keys(counts).length ? Object.entries(counts).map(([k, n]) => `${n} ${TALLY_VOUCHER_LABELS[k as TallyVoucherKind]}`).join(" · ") + " pending" : "Nothing pending for these dates."}</p>
      <Message value={message} />
      {result?.issues.length ? <div role="alert" className="space-y-1 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><p className="font-semibold">Kept back (they stay pending):</p>{result.issues.slice(0, 20).map((i, n) => <p key={n}><b>{i.voucher}</b>: {i.message}</p>)}</div> : null}
    </Section>
    <Section title="Vouchers" actions={<select aria-label="Show" className={`${inputClass} w-36`} value={show} onChange={e => { setShow(e.target.value as typeof show); setPage(1); }}><option value="pending">Pending</option><option value="all">All in range</option></select>}>
      {pending.loading && !pending.data ? <Loading what="vouchers" /> : pending.error ? <Failure text={pending.error} /> : !pending.data?.rows.length ? <Empty>No vouchers.</Empty> :
        <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead><tr className="text-left text-neutral-500"><th className="py-1">Date</th><th>Type</th><th>Number</th><th>Party</th><th>Amount</th><th>Exported</th></tr></thead>
          <tbody>{pending.data.rows.map(r => <tr key={`${r.kind}:${r.id}`} className="border-t border-neutral-100"><td className="py-2">{fmtDay(r.date)}</td><td>{TALLY_VOUCHER_LABELS[r.kind]}</td><td className="font-mono">{r.number}</td><td>{r.party ?? "—"}</td><td>{inr(r.amount)}</td>
            <td>{r.exported_at ? reExport?.row.id === r.id ? <span className="flex gap-1"><input aria-label="Why export again" className="h-9 w-48 rounded-lg border px-2" value={reExport.reason} onChange={e => setReExport({ row: r, reason: e.target.value })} />
              <button type="button" className="underline" onClick={async () => { if (await apWrite("ap_tally", "re_export", { kind: r.kind, voucher_id: r.id, reason: reExport.reason.trim() }, setMessage, `${r.number} will be exported again.`)) { setReExport(null); setKey(k => k + 1); } }}>Re-export</button></span>
              : <span>{fmtWhen(r.exported_at)} <button type="button" className="underline" onClick={() => setReExport({ row: r, reason: "" })}>Re-export</button></span> : "Pending"}</td></tr>)}</tbody></table></div>}
      {pending.data ? <Pager page={page} total={pending.data.total_count} onPage={setPage} /> : null}
    </Section>
    <Section title="Ledger mapping" description="Names exactly as in Tally. Parties without a mapping use their name in ExtrusionOS; sales ledgers can be set per GST rate and local/interstate.">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-sm font-semibold">Ledger for<select className={`${inputClass} mt-1`} value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value as TallyLedgerKind })}>{Object.entries(TALLY_LEDGER_KINDS).filter(([k]) => k !== "customer" && k !== "vendor").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {form.kind === "sales" || form.kind === "purchase" ? <><label className="text-sm font-semibold">GST rate (optional)<input inputMode="decimal" className={`${inputClass} mt-1`} value={form.gst_rate} onChange={e => setForm({ ...form, gst_rate: e.target.value })} placeholder="18" /></label>
          <label className="text-sm font-semibold">Supply<select className={`${inputClass} mt-1`} value={form.supply} onChange={e => setForm({ ...form, supply: e.target.value })}><option value="">Any</option><option value="local">Local</option><option value="interstate">Interstate</option></select></label></> : null}
        <label className="text-sm font-semibold">Tally ledger name<input className={`${inputClass} mt-1`} value={form.ledger_name} onChange={e => setForm({ ...form, ledger_name: e.target.value })} /></label>
        <div className="flex items-end"><button type="button" className={secondaryClass} onClick={async () => {
          const payload: Record<string, unknown> = { kind: form.kind, ledger_name: form.ledger_name.trim() };
          if (form.gst_rate.trim()) payload.gst_rate = Number(form.gst_rate);
          if (form.supply) payload.supply = form.supply;
          if (await apWrite("ap_tally", "save_mapping", payload, setMessage, "Ledger mapped.")) { setForm({ ...form, ledger_name: "", gst_rate: "" }); setKey(k => k + 1); }
        }}>Save mapping</button></div>
      </div>
      {mappings.loading && !mappings.data ? <Loading what="mappings" /> : mappings.error ? <Failure text={mappings.error} /> : !mappings.data?.rows.length ? <Empty>No ledger mapped yet.</Empty> :
        <ul className="space-y-1 text-sm">{mappings.data.rows.map(m => <li key={m.id} className="flex flex-wrap items-center justify-between gap-2"><span>{TALLY_LEDGER_KINDS[m.kind]}{m.entity ? ` · ${m.entity}` : ""}{m.gst_rate !== null ? ` · ${m.gst_rate}%` : ""}{m.supply ? ` · ${m.supply}` : ""} → <b>{m.ledger_name}</b></span>
          <button type="button" className="underline" onClick={async () => { if (await apWrite("ap_tally", "remove_mapping", { id: m.id }, setMessage, "Mapping removed.")) setKey(k => k + 1); }}>Remove</button></li>)}</ul>}
    </Section>
    <Section title="Export history">
      {batches.loading && !batches.data ? <Loading what="exports" /> : batches.error ? <Failure text={batches.error} /> : !batches.data?.rows.length ? <Empty>No export yet.</Empty> :
        <ul className="space-y-1 text-sm">{batches.data.rows.map(b => <li key={b.id}>{fmtWhen(b.generated_at)} by {b.generated_by} · {fmtDay(b.from)}{b.to !== b.from ? ` to ${fmtDay(b.to)}` : ""} · {b.vouchers} voucher(s){b.re_exports ? ` · ${b.re_exports} re-export(s)` : ""}{b.superseded ? ` · ${b.superseded} later re-exported` : ""}</li>)}</ul>}
      {batches.data ? <Pager page={bPage} total={batches.data.total_count} onPage={setBPage} /> : null}
    </Section>
  </div>;
}
