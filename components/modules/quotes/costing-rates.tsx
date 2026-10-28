"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { costingRateAction } from "@/lib/actions/costing-rates";
import { BASES, RATE_FINISHING_TYPES, RATE_TYPES, draftProblem, type Basis, type RateType } from "@/lib/workflow/costing-rates";

type Option = { value: string; label: string };
export type DraftInitial = { id: string; rate_type: RateType; basis: Basis; customer_id: string | null; alloy: string | null; finishing_type: string | null; rate: number; effective_from: string; effective_to: string | null; note: string | null };

// UPGRADE_EOS feature 85: enter or edit a draft rate. It takes effect only after another person approves it.
export function CostingRateForm({ rateId, customers, initial, today }: { rateId: string; customers: Option[]; initial?: DraftInitial; today: string }) {
  const router = useRouter();
  const [form, setForm] = useState({
    rate_type: initial?.rate_type ?? "billet" as RateType, basis: initial?.basis ?? "per_kg" as Basis, customer_id: initial?.customer_id ?? "",
    alloy: initial?.alloy ?? "", finishing_type: initial?.finishing_type ?? "", rate: initial ? String(initial.rate) : "",
    effective_from: initial?.effective_from ?? today, effective_to: initial?.effective_to ?? "", note: initial?.note ?? ""
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const isFinishing = form.rate_type === "finishing";
  const problem = draftProblem({ rate_type: form.rate_type, basis: isFinishing ? form.basis : "per_kg", alloy: form.rate_type === "billet" ? form.alloy || null : null, finishing_type: isFinishing ? form.finishing_type || null : null, effective_from: form.effective_from, effective_to: form.effective_to || null });

  async function save() {
    const rate = Number(form.rate);
    if (!form.rate.trim() || !Number.isFinite(rate) || rate <= 0) { setMessage("Enter a positive rate"); return; }
    setBusy(true); setMessage("");
    const result = await costingRateAction({
      command: "rates.save_draft", id: rateId, rate_type: form.rate_type, basis: isFinishing ? form.basis : "per_kg", customer_id: form.customer_id || null,
      alloy: form.rate_type === "billet" && form.alloy.trim() ? form.alloy : null, finishing_type: isFinishing ? form.finishing_type || null : null,
      rate, effective_from: form.effective_from, effective_to: form.effective_to || null, note: form.note
    });
    setBusy(false);
    if (!result.success) { setMessage(result.error); return; }
    router.push("/quotes/rates?status=draft");
    router.refresh();
  }

  return (
    <form className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-1"><span className="form-label">Rate type</span>
          <select className="form-input" value={form.rate_type} disabled={busy} onChange={(event) => setForm({ ...form, rate_type: event.target.value as RateType, basis: "per_kg" })}>
            {Object.entries(RATE_TYPES).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </label>
        {isFinishing ? (
          <>
            <label className="space-y-1"><span className="form-label">Finishing type</span>
              <select className="form-input" value={form.finishing_type} disabled={busy} onChange={(event) => setForm({ ...form, finishing_type: event.target.value })}>
                <option value="">Choose</option>{RATE_FINISHING_TYPES.map((type) => <option key={type} value={type}>{type.replace(/_/g, " ")}</option>)}
              </select>
            </label>
            <label className="space-y-1"><span className="form-label">Basis</span>
              <select className="form-input" value={form.basis} disabled={busy} onChange={(event) => setForm({ ...form, basis: event.target.value as Basis })}>
                {Object.entries(BASES).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
              </select>
            </label>
          </>
        ) : form.rate_type === "billet" ? (
          <label className="space-y-1"><span className="form-label">Alloy (optional)</span><input className="form-input" maxLength={8} placeholder="All alloys, or e.g. 6061" value={form.alloy} disabled={busy} onChange={(event) => setForm({ ...form, alloy: event.target.value.toUpperCase() })} /></label>
        ) : null}
        <label className="space-y-1"><span className="form-label">Customer agreement (optional)</span>
          <select className="form-input" value={form.customer_id} disabled={busy} onChange={(event) => setForm({ ...form, customer_id: event.target.value })}>
            <option value="">General rate (all customers)</option>{customers.map((customer) => <option key={customer.value} value={customer.value}>{customer.label}</option>)}
          </select>
        </label>
        <label className="space-y-1"><span className="form-label">Rate (₹ {isFinishing ? BASES[form.basis] : "per kg"})</span><input className="form-input" inputMode="decimal" value={form.rate} disabled={busy} onChange={(event) => setForm({ ...form, rate: event.target.value })} /></label>
        <label className="space-y-1"><span className="form-label">Effective from</span><input className="form-input" type="date" value={form.effective_from} disabled={busy} onChange={(event) => setForm({ ...form, effective_from: event.target.value })} /></label>
        <label className="space-y-1"><span className="form-label">Effective to (optional)</span><input className="form-input" type="date" value={form.effective_to} disabled={busy} onChange={(event) => setForm({ ...form, effective_to: event.target.value })} /></label>
        <label className="space-y-1 md:col-span-3"><span className="form-label">Note (optional)</span><input className="form-input" maxLength={300} placeholder="e.g. LME + premium for Q3, or annual agreement reference" value={form.note} disabled={busy} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
      </div>
      <p className="text-xs text-slate-500">Saving keeps this as a draft. Another person (owner, admin or sales manager) must approve it; approving ends the previous rate for the same scope the day before this one starts.</p>
      {problem ? <p className="text-xs font-semibold text-red-700">{problem}</p> : null}
      <Button type="submit" disabled={busy || Boolean(problem) || !form.effective_from}>{busy ? "Saving…" : "Save draft"}</Button>
      {message ? <p role="alert" className="text-sm font-semibold text-red-700">{message}</p> : null}
    </form>
  );
}

// Approve (four eyes) or withdraw (with a reason) one rate.
export function CostingRateDecision({ rateId, canApprove, canWithdraw }: { rateId: string; canApprove: boolean; canWithdraw: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [message, setMessage] = useState("");
  async function run(input: unknown) {
    setBusy(true); setMessage("");
    const result = await costingRateAction(input);
    setBusy(false);
    if (!result.success) { setMessage(result.error); return; }
    setWithdrawing(false); setReason("");
    router.refresh();
  }
  if (!canApprove && !canWithdraw) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canApprove ? <Button type="button" disabled={busy} onClick={() => void run({ command: "rates.approve", id: rateId })}>{busy ? "Working…" : "Approve"}</Button> : null}
      {canWithdraw && !withdrawing ? <Button type="button" variant="secondary" disabled={busy} onClick={() => setWithdrawing(true)}>Withdraw</Button> : null}
      {withdrawing ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void run({ command: "rates.withdraw", id: rateId, reason }); }}>
          <input className="form-input w-56" aria-label="Reason for withdrawing" maxLength={300} placeholder="Reason (required)" value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} />
          <Button type="submit" variant="secondary" disabled={busy || reason.trim().length < 3}>Confirm withdraw</Button>
          <button type="button" className="text-xs font-bold underline" disabled={busy} onClick={() => setWithdrawing(false)}>Cancel</button>
        </form>
      ) : null}
      {message ? <p role="alert" className="w-full text-sm font-semibold text-red-700">{message}</p> : null}
    </div>
  );
}
