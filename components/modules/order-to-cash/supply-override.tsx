"use client";

// AP-037 on the invoice form: the place of supply derived from the customer's GSTIN, a one-tap "use it", and a recorded
// reason when a different state is chosen (needed once accounts confirmed the rule; the database enforces it). Uses the
// browser client so the invoice form does not pull server actions into bundles that render it.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { GST_STATE_OPTIONS } from "@/lib/order-to-cash/commands";

type Derived = { state: string | null; basis: string; tax_type: string | null; confirmed: boolean };
const stateName = (code: string | null) => GST_STATE_OPTIONS.find(([c]) => c === code)?.[1] ?? code ?? "—";

export function SupplyOverride({ orderId, dispatchId, chosen, onDerived }: { orderId: string | null; dispatchId: string | null; chosen: string; onDerived: (state: string) => void }) {
  const [derived, setDerived] = useState<Derived | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    setDerived(null);
    if (!orderId) return;
    let active = true;
    const supabase = createClient() as unknown as { rpc?: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
    if (typeof supabase.rpc !== "function") return;
    Promise.resolve(supabase.rpc("ap_billing", { p_command: "gst_derive", p_payload: { order_id: orderId } }))
      .then(result => { if (active && !result.error && result.data && typeof result.data === "object") setDerived(result.data as Derived); }, () => undefined);
    return () => { active = false; };
  }, [orderId]);
  if (!orderId || !derived) return null;
  async function record() {
    const supabase = createClient() as unknown as { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message?: string } | null }> };
    const result = await supabase.rpc("ap_billing", { p_command: "gst_override", p_payload: { dispatch_id: dispatchId, state: chosen, reason: reason.trim() } });
    setMessage(result.error ? { ok: false, text: result.error.message?.replace(/^AP: /, "") ?? "The override could not be recorded." } : { ok: true, text: "Override recorded for this invoice (valid 2 hours)." });
  }
  const differs = Boolean(derived.state && chosen && chosen !== derived.state);
  return <span className="block space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
    <span className="block">Derived: <b>{stateName(derived.state)}</b> ({derived.basis.replaceAll("_", " ")}{derived.tax_type ? `, ${derived.tax_type === "igst" ? "IGST" : "CGST + SGST"}` : ""}).{" "}
      {derived.state && chosen !== derived.state ? <button type="button" className="font-semibold underline" onClick={() => onDerived(derived.state!)}>Use {stateName(derived.state)}</button> : null}</span>
    {!derived.state ? <span className="block text-amber-900">The customer has no valid GSTIN or recognised state: choose the state and correct the customer record.</span> : null}
    {differs && derived.confirmed && dispatchId ? <span className="flex flex-wrap gap-2">
      <input aria-label="Reason for a different place of supply" value={reason} onChange={e => setReason(e.target.value)} className="form-input flex-1" placeholder="Reason (for example: bill-to party in another state)" />
      <button type="button" className="rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold" onClick={() => void record()}>Record override</button></span> : null}
    {message ? <span role={message.ok ? "status" : "alert"} className={`block font-semibold ${message.ok ? "text-emerald-800" : "text-rose-800"}`}>{message.text}</span> : null}
  </span>;
}
