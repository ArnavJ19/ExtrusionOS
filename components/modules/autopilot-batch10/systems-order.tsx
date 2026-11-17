"use client";

// AP-070: a configurator project opened as a direct order. Off until the owner confirms that Omalco sells window and door
// systems. The cutting list becomes order lines of whole stock lengths with the free stock of each; sales enters the
// agreed rate and saves through the normal direct order, and the project then records the order.
import { useState } from "react";
import Link from "next/link";
import { linkSystemOrderAction, type SystemOrderPrefill } from "@/lib/actions/autopilot-batch10";
import { DirectOrderFormClient } from "@/components/modules/orders/direct-order-form-client";
import { fmtWhen } from "@/lib/order-to-cash/commands";
import { Failure, Loading, Message, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";

type Note = { tone: "ok" | "error"; text: string } | null;
type Settings = { enabled: boolean; can_decide: boolean; decision: { note: string | null; decided_by: string | null; decided_at: string } | null };
type Status = { enabled: boolean; order_id: string | null; status: string; blocked: string | null; link: { order_id: string; order_number: string | null; linked_at: string; linked_by: string | null; configuration_updated: boolean } | null };

/** The owner's decision: does Omalco sell systems? */
export function SystemsOrderSetting() {
  const read = useApRead<Settings>("ap_systems_order", "settings", {}, []);
  const [text, setText] = useState(""); const [note, setNote] = useState<Note>(null);
  async function set(enabled: boolean) { if (await apWrite("ap_systems_order", "save_settings", { enabled, ...(text.trim().length >= 3 ? { note: text.trim() } : {}) }, setNote, enabled ? "Turned on: projects can be opened as orders." : "Turned off.")) { setText(""); await read.reload(); } }
  return <Section id="system-orders" title="Orders from configurator projects" description="Turn this on only if Omalco sells window and door systems. While it is off, projects cannot be opened as orders.">
    {read.loading && !read.data ? <Loading what="the setting" /> : read.error ? <Failure text={read.error} /> : read.data ? <>
      <p className="text-sm">Currently <b>{read.data.enabled ? "on" : "off"}</b>{read.data.decision ? ` · decided by ${read.data.decision.decided_by ?? "—"} ${fmtWhen(read.data.decision.decided_at)}${read.data.decision.note ? `: ${read.data.decision.note}` : ""}` : " · not decided yet"}.</p>
      {read.data.can_decide ? <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Note" className={`${inputClass} sm:w-72`} placeholder="Note (optional)" value={text} maxLength={300} onChange={e => setText(e.target.value)} />
        <button type="button" className={read.data.enabled ? secondaryClass : buttonClass} onClick={() => set(!read.data!.enabled)}>{read.data.enabled ? "Turn off" : "Turn on"}</button></div>
        : <p className="text-sm text-neutral-600">The owner or an admin decides this.</p>}
      <Message value={note} />
    </> : null}
  </Section>;
}

/** On the project record: open it as an order, or the order it already became. */
export function SystemOrderPanel({ configurationId }: { configurationId: string }) {
  const read = useApRead<Status>("ap_systems_order", "status", { configuration_id: configurationId }, []);
  if (read.loading && !read.data) return null;
  if (read.error || !read.data) return null;
  const s = read.data;
  return <Section id="system-order" title="Order from this project" description="Order lines of whole stock lengths from the cutting list, with free stock shown for each. Sales reviews and saves the order.">
    {s.link ? <p className="text-sm">Ordered as <Link className="font-bold underline" href={`/orders/${s.link.order_id}`}>{s.link.order_number ?? "order"}</Link> by {s.link.linked_by ?? "—"} {fmtWhen(s.link.linked_at)}.{s.link.configuration_updated ? "" : " The project's status was not moved by its own lifecycle rules; the link is recorded here."}</p>
      : s.blocked ? <p className="rounded-xl bg-neutral-50 px-3 py-2 text-sm text-neutral-700">{s.blocked}</p>
      : <Link href={`/orders/new?source=direct&system=${configurationId}`} className={`${buttonClass} inline-flex items-center`}>Open as order</Link>}
  </Section>;
}

/** The direct order form filled from the project. Rates are typed by sales; the project is linked after the order is saved. */
export function SystemOrderForm({ prefill }: { prefill: SystemOrderPrefill }) {
  const [linked, setLinked] = useState<Note>(null);
  const short = prefill.lines.filter(l => l.short_pieces > 0);
  return <div className="space-y-5">
    <section aria-label="Order from configurator project" className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
      <h2 className="font-black">From configurator project {prefill.number ?? ""}{prefill.project_name ? ` · ${prefill.project_name}` : ""}</h2>
      <p>{prefill.lines.length} profile line(s) of whole stock lengths are filled from the cutting list. Enter the agreed rate on each line, check HSN and GST, then create the order.</p>
      <ul className="divide-y divide-sky-200 rounded-xl border border-sky-200 bg-white">{prefill.lines.map(l => <li key={`${l.profile_id}:${l.stock_length_m}`} className="flex flex-wrap justify-between gap-2 p-2">
        <span><b>{l.profile_code}</b> · {l.pieces} × {l.stock_length_m} m ({l.cuts} cuts, {l.offcut_m} m offcut){l.weight_kg !== null ? ` · ${l.weight_kg.toLocaleString("en-IN")} kg` : ""}</span>
        <span className={l.short_pieces ? "font-bold text-amber-800" : "font-bold text-emerald-800"}>{l.free_pieces} free in stock{l.short_pieces ? ` · ${l.short_pieces} to produce` : " · covered"}</span></li>)}</ul>
      {short.length ? <p>{short.length} line(s) are not fully in stock; the balance goes through normal production planning after the order is saved.</p> : <p>Every line is covered by free stock of that length. Stock is reserved through the order&apos;s stock plan, not here.</p>}
      {prefill.skipped.length ? <div><p className="font-bold">Not on the order:</p><ul className="list-disc pl-5">{prefill.skipped.map((s, index) => <li key={index}>{s.profile_code}: {s.reason}</li>)}</ul></div> : null}
      {prefill.hardware.length ? <p>Hardware ({prefill.hardware.length} item(s)) and other materials are listed in the order notes; order lines carry profiles only.</p> : null}
      <Message value={linked} />
    </section>
    <DirectOrderFormClient prefill={{ customer: prefill.customer, notes: prefill.notes,
        lines: prefill.lines.map(l => ({ profile: { id: l.profile_id, profile_code: l.profile_code, profile_name: l.profile_name, section_weight_kg_per_m: Number(l.kg_per_m ?? 0), hsn_code: l.hsn_code }, quantity_pieces: l.pieces, length_per_piece_m: l.stock_length_m, finishing_type: prefill.finish })) }}
      onCreated={async orderId => {
        const out = await linkSystemOrderAction({ configuration_id: prefill.configuration_id, order_id: orderId, lines: prefill.lines.map(l => ({ profile_code: l.profile_code, stock_length_m: l.stock_length_m, pieces: l.pieces, free_pieces: l.free_pieces })) });
        setLinked(out.success ? { tone: "ok", text: `Project linked to ${out.data.order_number}.` } : { tone: "error", text: out.error });
        return out.success ? null : out.error;
      }} />
  </div>;
}
