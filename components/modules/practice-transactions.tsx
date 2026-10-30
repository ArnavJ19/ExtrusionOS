"use client";
import { useState } from "react";
import { confirmPracticeTransaction, newPracticeLedger, reviewPracticeTransaction, type PracticeLedger, type PracticeOperation, type PracticeProposal } from "@/lib/training/practice-transactions";

const defaults = {
  quotation: { pieces: "10", length_m: "6", rate_inr_per_kg: "250", gst_percent: "18" },
  inspection: { accepted_pieces: "92", rejected_pieces: "5", held_pieces: "3", accepted_kg: "441.6", rejected_kg: "24", held_kg: "14.4" },
  dispatch: { pieces: "20", metres: "120", actual_kg: "96" }
};
export function PracticeTransactions() {
  const [ledger, setLedger] = useState<PracticeLedger | null>(null);
  const [operation, setOperation] = useState<PracticeOperation>("quotation");
  const [values, setValues] = useState<Record<string, string>>(defaults.quotation);
  const [proposal, setProposal] = useState<PracticeProposal | null>(null), [last, setLast] = useState<PracticeProposal | null>(null);
  const [message, setMessage] = useState("");
  function start(next: PracticeOperation) { setOperation(next); setValues(defaults[next]); setProposal(null); setLast(null); setMessage(""); }
  function review() {
    try {
      const current = ledger ?? newPracticeLedger(crypto.randomUUID());
      const input = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim() === "" ? NaN : Number(value)]));
      setProposal(reviewPracticeTransaction(current, operation, input, crypto.randomUUID())); setLedger(current); setMessage("");
    } catch (error) { setProposal(null); setMessage(error instanceof Error ? error.message : "Review the sample inputs."); }
  }
  function confirm(reviewed: PracticeProposal) {
    if (!ledger) return;
    try {
      const result = confirmPracticeTransaction(ledger, reviewed); setLedger(result.state); setLast(reviewed); setProposal(null);
      setMessage(`${result.event.number} ${result.replayed ? "replayed without a second entry" : "recorded in this page's sample ledger"}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Sample confirmation failed."); }
  }
  return <section className="space-y-5 rounded-xl border bg-white p-5">
    <h2 className="text-xl font-semibold">Sample operations desk</h2>
    <p className="text-sm text-slate-600">Sample profile: 0.8 kg/m. Inspection lot: 100 pieces, measured 480 kg. Dispatch source remaining: {ledger?.remaining.pieces ?? 80} pieces / {ledger?.remaining.metres ?? 480} m / {ledger?.remaining.kg ?? 384} kg.</p>
    <div className="flex flex-wrap gap-2">{(["quotation", "inspection", "dispatch"] as const).map(kind => <button key={kind} type="button" className="rounded border px-3 py-2 capitalize aria-pressed:bg-slate-900 aria-pressed:text-white" aria-pressed={operation === kind} onClick={() => start(kind)}>Sample {kind}</button>)}</div>
    <form onSubmit={event => { event.preventDefault(); review(); }} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">{Object.entries(values).map(([name, value]) => <label key={name} className="block text-sm capitalize">Sample {name.replaceAll("_", " ")}<input className="mt-1 block w-full rounded border p-3" type="number" min="0" step="any" required value={value} onChange={event => { setValues(current => ({ ...current, [name]: event.target.value })); setProposal(null); setLast(null); }} /></label>)}</div>
      <button type="submit" className="rounded border px-4 py-3">Review sample transaction</button>
    </form>
    {proposal ? <div className="space-y-3 rounded-lg bg-slate-50 p-4"><h3 className="font-semibold">Reviewed sample proposal</h3><p>{proposal.explanation}</p><dl className="grid grid-cols-2 gap-3">{Object.entries(proposal.totals).map(([name, value]) => <div key={name}><dt className="capitalize">{name.replaceAll("_", " ")}</dt><dd>{value.toLocaleString("en-IN", { maximumFractionDigits: 3 })}</dd></div>)}</dl><button type="button" className="rounded bg-slate-900 px-4 py-3 text-white" onClick={() => confirm(proposal)}>Confirm sample transaction</button></div> : null}
    {last ? <button type="button" className="rounded border px-4 py-3" onClick={() => confirm(last)}>Replay same sample request</button> : null}
    <p role="status" aria-live="polite">{message}</p><p className="text-sm">Sample ledger entries: {ledger?.events.length ?? 0}. No production record, stock movement, file or message is created.</p>
    <button type="button" className="rounded border px-4 py-3" onClick={() => { setLedger(newPracticeLedger(crypto.randomUUID())); start("quotation"); }}>Reset sample operations desk</button>
  </section>;
}
