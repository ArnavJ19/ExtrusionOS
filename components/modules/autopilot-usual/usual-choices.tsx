"use client";

// AP-026: a customer's usual choices, shown on the quotation, order and loading screens once the customer is known.
// Each value says where it came from ("used in 3 of the last 5 orders", or "agreed on the customer record"); nothing is
// filled in until the person taps "Use". Agreed master values beat learned ones; fields without a clear pattern are
// not shown. Every "Use" and "Not now" is logged so the rule can be reviewed.
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { autopilotAction } from "@/lib/actions/autopilot";

export type UsualField = "finish" | "payment_terms" | "delivery_timeline" | "packing" | "transporter" | "priority" | "delivery_address";
type Suggestion = { value: string; source: "learned" | "master"; count?: number; of?: number; basis?: string };
type Usual = { customer_id: string; fields: Partial<Record<UsualField, Suggestion>> };

export const USUAL_LABELS: Record<UsualField, string> = { finish: "Finish", payment_terms: "Payment terms", delivery_timeline: "Delivery", packing: "Packing", transporter: "Transporter",
  priority: "Priority", delivery_address: "Delivery address" };
const pretty = (field: UsualField, value: string) => (field === "finish" || field === "priority" ? value.replaceAll("_", " ").replace(/^./, c => c.toUpperCase()) : value);

export function usualWhy(s: Suggestion): string {
  if (s.source === "master") return "agreed on the customer record";
  return `used in ${s.count} of the last ${s.of} ${s.basis ?? "records"}`;
}

/** Shows the usual values for the fields given. `current` holds what the form has now; a field already equal to the
 *  suggestion (or changed by the person and not blank) is not offered again. */
export function UsualChoicesHint({ customerId, surface, fields, current, onUse }: { customerId: string | null | undefined; surface: "quote" | "order" | "loading";
  fields: UsualField[]; current: Partial<Record<UsualField, string | null | undefined>>; onUse: (field: UsualField, value: string) => void }) {
  const [usual, setUsual] = useState<Usual | null>(null);
  const [hidden, setHidden] = useState<Set<UsualField>>(new Set());
  useEffect(() => {
    let live = true; setUsual(null); setHidden(new Set());
    if (!customerId) return;
    void autopilotAction("ap_usual", "customer", { customer_id: customerId }).then(result => { if (live && result.success) setUsual(result.data as Usual); });
    return () => { live = false; };
  }, [customerId]);
  if (!customerId || !usual) return null;
  const offers = fields.flatMap(field => {
    const s = usual.fields[field];
    if (!s || hidden.has(field)) return [];
    const now = (current[field] ?? "").toString().trim().toLowerCase();
    if (now && now === s.value.trim().toLowerCase()) return [];
    return [{ field, s }];
  });
  if (!offers.length) return null;
  const log = (field: UsualField, s: Suggestion, decision: "used" | "dismissed") => {
    if (field === "delivery_address") return;
    void autopilotAction("ap_usual", "decide", { customer_id: customerId, field, surface, source: s.source, suggested: s.value.slice(0, 300), decision });
  };
  return <section aria-label="Usual for this customer" className="min-w-0 space-y-2 rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm">
    <p className="flex items-center gap-2 font-bold text-sky-950"><Sparkles className="h-4 w-4" aria-hidden="true" />Usual for this customer</p>
    <ul className="space-y-2">{offers.map(({ field, s }) => <li key={field} className="flex flex-wrap items-center justify-between gap-2">
      <span className="min-w-0 break-words"><b>{USUAL_LABELS[field]}:</b> {pretty(field, s.value)} <span className="text-sky-800">({usualWhy(s)})</span></span>
      <span className="flex gap-2">
        <button type="button" className="min-h-10 rounded-lg bg-sky-900 px-3 font-bold text-white" onClick={() => { onUse(field, s.value); log(field, s, "used"); setHidden(h => new Set(h).add(field)); }}>Use</button>
        <button type="button" className="min-h-10 rounded-lg border border-sky-300 bg-white px-3 font-semibold" onClick={() => { log(field, s, "dismissed"); setHidden(h => new Set(h).add(field)); }}>Not now</button>
      </span>
    </li>)}</ul>
  </section>;
}
