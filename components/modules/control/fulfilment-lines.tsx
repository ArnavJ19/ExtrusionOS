import { LEDGER_STATUS, type FulfilmentLedger } from "@/lib/workflow/operations-control";

const kg = (value: number | null) => (value === null ? "Unavailable" : value.toLocaleString("en-IN", { maximumFractionDigits: 3 }));

/** NOV-005: per-line stage balances. Each figure comes from its own source; unavailable is never shown as zero. */
export function FulfilmentLines({ ledger }: { ledger: FulfilmentLedger }) {
  const unavailable = Object.entries(ledger.sources).filter(([, state]) => state === "unavailable").map(([name]) => name);
  return <section aria-label="Order fulfilment ledger" className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
    <div className="space-y-1"><h2 className="text-lg font-bold">Ordered, made, held, shipped and returned</h2><p className="text-sm font-semibold">{LEDGER_STATUS[ledger.status]}</p>
      <p className="text-xs text-slate-600">{ledger.basis}</p></div>
    {unavailable.length ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-950">Could not read: {unavailable.join(", ")}. Those figures show as unavailable; do not treat them as zero.</p> : null}
    {ledger.unlinked.packing_rows || ledger.unlinked.returns || ledger.unlinked.jobs || ledger.unlinked.held_jobs ? <p role="note" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
      Not attributed to a line: {ledger.unlinked.packing_rows} packing row(s) ({kg(ledger.unlinked.packing_kg)} kg), {ledger.unlinked.returns} open return(s) ({kg(ledger.unlinked.returned_kg)} kg), {ledger.unlinked.jobs} production job(s){ledger.unlinked.held_jobs ? `, ${ledger.unlinked.held_jobs} on hold` : ""}. They are counted only at order level and need reconciliation.</p> : null}
    <div className="space-y-3">{ledger.lines.map(line => <article key={line.id} className="rounded-xl border border-slate-200 p-3">
      <h3 className="break-words font-semibold">{line.label}{line.over_departed ? <span className="ml-2 text-sm font-bold text-red-800">More departed than ordered</span> : null}</h3>
      <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {([["Ordered kg", line.ordered_kg], ["From stock kg", line.from_stock_kg], ["Produced kg", line.produced_kg], ["Open production kg", line.planned_open_kg],
          ["Production hold output kg", line.held_output_kg], ["QC hold kg", line.qc_hold_kg], ["Packed kg", line.packed_kg], ["Departed kg", line.departed_kg],
          ["Delivered kg", line.delivered_kg], ["Returned kg", line.returned_kg], ["Remaining to depart kg", line.remaining_to_depart_kg]] as const).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs font-bold text-slate-500">{label}</dt><dd className="tabular-nums">{kg(value)}</dd></div>)}
      </dl>
      {line.held_jobs ? <p className="mt-2 text-xs font-semibold text-amber-900">{line.held_jobs} production job(s) on hold for this line.</p> : null}
      {line.open_returns ? <p className="mt-1 text-xs font-semibold text-amber-900">{line.open_returns} return(s) awaiting inspection or disposition.</p> : null}
    </article>)}</div>
    {ledger.line_count > ledger.lines.length ? <p className="text-xs text-slate-600">Showing the first {ledger.lines.length} of {ledger.line_count} lines.</p> : null}
    <p className="text-xs text-slate-500">Read as of {new Date(ledger.as_of).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST.</p>
  </section>;
}
