"use client";

// FS-65: the weight-basis policy screen (owner decides; others read) and the dispatch panel that shows theoretical and
// actual weight side by side for every packed bundle.
import { useState } from "react";
import { WEIGHT_BASES, type WeightBasis } from "@/lib/fs-batch4/commands";
import { WEIGHT_STATE_LABELS, type WeightState } from "@/lib/calculations/weight-basis";
import { Empty, Failure, Loading, Message, Pill, Section, b4Write, buttonClass, inputClass, useB4Read, when, type Note } from "./shared";

type Policy = {
  stock_basis: string; invoice_basis: WeightBasis | null; default_tolerance_percent: number | null; decided_by: string | null; decided_at: string | null; reason: string | null; can_decide: boolean;
  customers: { customer_id: string; customer: string; invoice_basis: WeightBasis; reason: string; decided_by: string; decided_at: string }[];
  events: { id: string; field: string; old_value: string | null; new_value: string | null; reason: string; actor_name: string; recorded_at: string }[];
};
const kg = (v: number | null | undefined) => v === null || v === undefined ? "—" : `${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`;
const basisLabel = (b: string | null | undefined) => b ? (WEIGHT_BASES as Record<string, string>)[b] ?? b : "Not decided";

export function WeightBasisSettings({ customers }: { customers: { id: string; name: string }[] }) {
  const { data, error, loading, reload } = useB4Read<Policy>("fs_weight_basis", "policy", {});
  const [message, setMessage] = useState<Note>(null);
  const [busy, setBusy] = useState(false);
  const [basis, setBasis] = useState<string>("__keep__");
  const [tolerance, setTolerance] = useState<string>("");
  const [reason, setReason] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerBasis, setCustomerBasis] = useState<string>("");
  const [customerReason, setCustomerReason] = useState("");
  if (loading && !data) return <Loading what="the weight policy" />;
  if (error) return <Failure text={error} />;
  if (!data) return null;

  async function savePolicy() {
    setBusy(true);
    const tol = tolerance.trim() === "" ? (data!.default_tolerance_percent ?? null) : Number(tolerance);
    const ok = await b4Write("fs_weight_basis", "save_policy", { invoice_basis: basis === "__keep__" ? data!.invoice_basis : (basis || null), default_tolerance_percent: tol, reason }, setMessage, "Weight policy saved.");
    setBusy(false);
    if (ok) { setReason(""); setTolerance(""); setBasis("__keep__"); void reload(); }
  }
  async function saveCustomer() {
    setBusy(true);
    const ok = await b4Write("fs_weight_basis", "save_customer", { customer_id: customerId, invoice_basis: customerBasis || null, reason: customerReason }, setMessage, "Customer basis saved.");
    setBusy(false);
    if (ok) { setCustomerReason(""); void reload(); }
  }

  return <div className="space-y-5">
    <Section title="The rule" description="One basis for every module. Stock is held in actual weighed kg; orders are placed in pieces and length.">
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-neutral-50 p-3"><dt className="text-xs font-bold uppercase text-neutral-500">Stock</dt><dd className="mt-1 font-bold">Actual weighed kg (fixed)</dd></div>
        <div className="rounded-xl bg-neutral-50 p-3"><dt className="text-xs font-bold uppercase text-neutral-500">Invoices</dt><dd className="mt-1 font-bold">{basisLabel(data.invoice_basis)}</dd>
          {!data.invoice_basis ? <dd className="mt-1 text-xs text-amber-800">Omalco has not decided yet. Invoices keep their current line quantities until the owner decides.</dd> : null}</div>
        <div className="rounded-xl bg-neutral-50 p-3"><dt className="text-xs font-bold uppercase text-neutral-500">Allowed difference</dt>
          <dd className="mt-1 font-bold">{data.default_tolerance_percent === null ? "Profile tolerance only" : `${data.default_tolerance_percent}% where the profile has none`}</dd></div>
      </dl>
      <p className="text-xs text-neutral-600">Theoretical kg = pieces × cut length × the profile&apos;s kg/m, to 3 decimals. The profile&apos;s weight tolerance applies first.{data.decided_by ? ` Last decided by ${data.decided_by}, ${when(data.decided_at)}.` : ""}</p>
    </Section>

    {data.can_decide ? <Section title="Decide" description="Only the owner records the basis. Each change is kept with its reason.">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">Invoice basis
          <select className={inputClass} value={basis === "__keep__" ? data.invoice_basis ?? "" : basis} onChange={e => setBasis(e.target.value)}>
            <option value="">Not decided</option>
            {Object.entries(WEIGHT_BASES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <label className="text-sm font-semibold">Company default tolerance (%)
          <input className={inputClass} inputMode="decimal" placeholder={data.default_tolerance_percent === null ? "None" : String(data.default_tolerance_percent)} value={tolerance} onChange={e => setTolerance(e.target.value)} /></label>
        <label className="text-sm font-semibold sm:col-span-2">Reason
          <input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} placeholder="For example: decided with the CA on 18 Nov" /></label>
      </div>
      <button type="button" className={buttonClass} disabled={busy || reason.trim().length < 5} onClick={savePolicy}>Save the policy</button>
    </Section> : null}

    <Section title="Customer exceptions" description="A customer whose contract bills on the other basis.">
      {data.customers.length === 0 ? <Empty>Every customer follows the company basis.</Empty> : <ul className="divide-y divide-neutral-200 text-sm">
        {data.customers.map(c => <li key={c.customer_id} className="py-2"><span className="font-bold">{c.customer}</span>: {basisLabel(c.invoice_basis)} <span className="text-neutral-500">— {c.reason} ({c.decided_by}, {when(c.decided_at)})</span></li>)}
      </ul>}
      {data.can_decide ? <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-semibold">Customer
          <select className={inputClass} value={customerId} onChange={e => setCustomerId(e.target.value)}>
            <option value="">Choose…</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        <label className="text-sm font-semibold">Basis
          <select className={inputClass} value={customerBasis} onChange={e => setCustomerBasis(e.target.value)}>
            <option value="">Company default</option>{Object.entries(WEIGHT_BASES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <label className="text-sm font-semibold">Reason<input className={inputClass} value={customerReason} onChange={e => setCustomerReason(e.target.value)} /></label>
        <button type="button" className={buttonClass} disabled={busy || !customerId || customerReason.trim().length < 5} onClick={saveCustomer}>Save customer basis</button>
      </div> : null}
    </Section>

    <Section title="Changes" description="The last ten decisions, newest first.">
      {data.events.length === 0 ? <Empty>No decision recorded yet.</Empty> : <ul className="space-y-2 text-sm">
        {data.events.map(e => <li key={e.id}><span className="font-semibold">{e.field.replaceAll("_", " ")}</span>: {e.old_value ?? "not set"} → {e.new_value ?? "not set"} <span className="text-neutral-500">— {e.reason} ({e.actor_name}, {when(e.recorded_at)})</span></li>)}
      </ul>}
    </Section>
    <Message value={message} />
  </div>;
}

type Line = { id: string; bundle: string; profile: string | null; pieces: number; length_m: number | null; theoretical_kg: number | null; actual_kg: number | null; difference_kg: number | null; difference_percent: number | null; tolerance_percent: number | null; tolerance_source: string | null; state: WeightState };
type DispatchWeights = { basis: { basis: WeightBasis | null; source: string; reason: string }; lines: Line[]; theoretical_kg: number | null; actual_kg: number | null; outside_tolerance: number; unknown: number };

export function DispatchWeightsPanel({ dispatchId }: { dispatchId: string }) {
  const { data, error, loading } = useB4Read<DispatchWeights>("fs_weight_basis", "dispatch_weights", { dispatch_id: dispatchId });
  return <Section title="Theoretical and actual weight" description="Every packed bundle: pieces × cut length × kg/m against the weighed net kg.">
    {loading && !data ? <Loading what="weights" /> : null}
    {error ? <Failure text={error} /> : null}
    {data ? <>
      <p className="text-sm">Invoice basis: <span className="font-bold">{basisLabel(data.basis.basis)}</span> <span className="text-neutral-500">({data.basis.source === "customer" ? "customer contract" : data.basis.source === "company" ? "company policy" : "undecided"})</span></p>
      {data.lines.length === 0 ? <Empty>No packed bundles on this dispatch.</Empty> : <div className="overflow-x-auto rounded-xl border border-neutral-200">
        <table className="industrial-table min-w-[720px]">
          <thead><tr><th>Bundle</th><th>Profile</th><th className="text-right">Pieces</th><th className="text-right">Theoretical</th><th className="text-right">Actual</th><th className="text-right">Difference</th><th>Check</th></tr></thead>
          <tbody>{data.lines.map(l => <tr key={l.id}>
            <td>{l.bundle}</td><td>{l.profile ?? "—"}</td><td className="text-right tabular-nums">{l.pieces}</td>
            <td className="text-right tabular-nums">{kg(l.theoretical_kg)}</td><td className="text-right tabular-nums">{kg(l.actual_kg)}</td>
            <td className="text-right tabular-nums">{l.difference_kg === null ? "—" : `${kg(l.difference_kg)} (${l.difference_percent}%)`}</td>
            <td><Pill value={l.state === "within" ? "passed" : l.state === "heavy" || l.state === "light" ? "held" : "unknown"} label={WEIGHT_STATE_LABELS[l.state]} />
              {l.tolerance_percent !== null ? <span className="ml-1 text-xs text-neutral-500">±{l.tolerance_percent}% ({l.tolerance_source})</span> : null}</td>
          </tr>)}</tbody>
          <tfoot><tr><td colSpan={3} className="font-bold">Total</td><td className="text-right font-bold tabular-nums">{kg(data.theoretical_kg)}</td><td className="text-right font-bold tabular-nums">{kg(data.actual_kg)}</td><td colSpan={2} className="text-sm">{data.outside_tolerance} outside tolerance · {data.unknown} cannot be checked</td></tr></tfoot>
        </table>
      </div>}
    </> : null}
  </Section>;
}
