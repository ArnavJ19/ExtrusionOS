import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";

// AP-060: the customer's order-status page, opened from a shared link without signing in. The database returns a
// fixed safe projection for a valid, unexpired, unrevoked token: no prices, cost, notes or other orders.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Order status", robots: { index: false, follow: false }, referrer: "no-referrer" };

type Line = { profile: string; finish: string; ordered_pieces: number | null; ordered_kg: number | null; produced_kg: number; packed_kg: number; dispatched_kg: number; dispatched_pieces: number };
type Dispatch = { number: string; date: string; vehicle: string | null; lr_number: string | null; transporter: string | null; status: string; bundles: number; net_kg: number; delivered_at: string | null };
type View = { state: "ok" | "invalid" | "revoked" | "expired"; expires_at?: string; as_of?: string;
  order?: { order_number: string; order_date: string; expected_dispatch_date: string | null; stage: string; customer: string; company: string | null; lines: Line[]; dispatches: Dispatch[] } };

const day = (v: string | null | undefined) => (v ? new Date(v.length === 10 ? `${v}T00:00:00+05:30` : v).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "—");
const kg = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`);

export default async function OrderStatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let view: View = { state: "invalid" };
  if (/^[0-9a-f]{64}$/.test(token)) {
    try {
      const supabase = await createClient();
      const result = await supabase.rpc("ap_order_status", { p_token: token });
      if (!result.error && result.data) view = result.data as View;
    } catch { view = { state: "invalid" }; }
  }
  if (view.state !== "ok" || !view.order) {
    const text = view.state === "expired" ? "This status link has expired. Ask Omalco Extrusion for a new one." : view.state === "revoked" ? "This status link is no longer active." : "This status link is not valid.";
    return <main className="mx-auto max-w-xl px-4 py-16 text-center"><h1 className="text-2xl font-black">Order status</h1><p className="mt-3 text-neutral-700">{text}</p></main>;
  }
  const o = view.order;
  return <main className="mx-auto max-w-3xl space-y-5 px-4 py-8">
    <header><p className="text-xs font-black uppercase tracking-[0.16em] text-orange-600">{o.company ?? "Omalco Extrusion"}</p>
      <h1 className="text-2xl font-black">Order {o.order_number}</h1>
      <p className="text-sm text-neutral-600">{o.customer} · ordered {day(o.order_date)} · expected dispatch {day(o.expected_dispatch_date)}</p>
      <p className="mt-2 inline-flex rounded-full bg-neutral-900 px-3 py-1 text-sm font-bold text-white">{o.stage}</p></header>
    <section className="space-y-2"><h2 className="text-lg font-black">Items</h2>
      <ul className="space-y-2">{o.lines.map((l, i) => <li key={i} className="rounded-2xl border border-neutral-200 p-3 text-sm">
        <p className="font-bold">{l.profile || "Profile"} <span className="font-normal text-neutral-500">· {l.finish}</span></p>
        <p>Ordered {l.ordered_pieces ? `${l.ordered_pieces} pcs / ` : ""}{kg(l.ordered_kg)}</p>
        <p className="text-neutral-700">Produced {kg(l.produced_kg)} · packed {kg(l.packed_kg)} · dispatched {kg(l.dispatched_kg)}{l.dispatched_pieces ? ` (${l.dispatched_pieces} pcs)` : ""}</p></li>)}</ul></section>
    <section className="space-y-2"><h2 className="text-lg font-black">Dispatches</h2>
      {o.dispatches.length ? <ul className="space-y-2">{o.dispatches.map(d => <li key={d.number} className="rounded-2xl border border-neutral-200 p-3 text-sm">
        <p className="font-bold">{d.number} · {day(d.date)} · {d.status}</p>
        <p>{d.bundles} bundle(s), {kg(d.net_kg)}{d.vehicle ? ` · vehicle ${d.vehicle}` : ""}{d.transporter ? ` · ${d.transporter}` : ""}{d.lr_number ? ` · LR ${d.lr_number}` : ""}{d.delivered_at ? ` · delivered ${day(d.delivered_at)}` : ""}</p></li>)}</ul>
        : <p className="text-sm text-neutral-600">Nothing has been dispatched yet.</p>}</section>
    <footer className="text-xs text-neutral-500">As of {view.as_of ? new Date(view.as_of).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "now"}. This link works until {day(view.expires_at)}.</footer>
  </main>;
}
