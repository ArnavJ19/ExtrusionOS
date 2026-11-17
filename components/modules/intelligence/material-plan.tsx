"use client";

// FS-27: what to buy and what to cast this week. Every suggested quantity lists the jobs and orders that drive it. The
// owner approves the week's plan; purchase and foundry record the purchase order or cast against each line.
import { useState } from "react";
import Link from "next/link";
import { fmtDay } from "@/lib/order-to-cash/commands";
import { MRP_ACTIONS } from "@/lib/intelligence/commands";
import { kgText } from "@/lib/intelligence/format";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, buttonClass, fsWrite, inputClass, secondaryClass, useFsRead, type Note } from "./shared";

type WeekRow = { week_start: string; firm_kg: number; uncertain_kg: number; incoming_kg: number; firm_shortfall_kg: number; total_shortfall_kg: number };
type Billet = { line_key: string; alloy: string; diameter_inch: number; free_kg: number; weeks: WeekRow[]; firm_shortfall_kg: number; total_shortfall_kg: number; need_by: string | null;
  firm_need_by: string | null; suggest_kg: number | null; suggest_billets: number | null; action: "none" | "cast" | "buy"; action_basis: string;
  drivers: { reference: string; href: string; week_start: string; kg: number; firm: boolean }[] };
type Line = { line_key: string; kind: string; action: string; label: string; quantity: number; unit: string; need_by?: string };
type Plan = { week_start: string; weeks: number; billet: Billet[]; unknown: { reference: string; href: string; firm: boolean; missing: string }[];
  consumables: { line_key: string; item_code: string; item_name: string; category: string; unit: string; current_stock: number; reorder_point: number; suggest_quantity: number; basis: string }[];
  dies: { line_key: string; die_id: string; die_number: string; profile_code: string | null; remaining_kg: number; open_demand_kg: number; lead_days: number | null; reason: string }[];
  lines: Line[]; fingerprint: string; basis: string;
  approved: null | { id: string; approved_at: string; approved_by: string; note: string | null; current: boolean; lines: Line[]; actions: Record<string, { action: string; reference: string | null; note: string | null; recorded_by: string; recorded_at: string }> } };

export function MaterialPlanClient({ canApprove }: { canApprove: boolean }) {
  const [key, setKey] = useState(0); const [message, setMessage] = useState<Note>(null); const [note, setNote] = useState(""); const [open, setOpen] = useState<string | null>(null);
  const d = useFsRead<Plan>("fs_mrp", "plan", { weeks: 8 }, [key]);
  const v = d.data;
  return <div className="space-y-5">
    <Message value={message} />
    {d.loading && !v ? <Loading what="the material plan" /> : d.error ? <Failure text={d.error} /> : v ? <>
      <Section title={`This week's plan (week of ${fmtDay(v.week_start)})`} description={v.basis}>
        {v.lines.length ? <ul className="divide-y rounded-xl border text-sm">{v.lines.map(l => <li key={l.line_key} className="flex flex-wrap items-center justify-between gap-2 p-3">
          <span><Pill value={l.action === "cast" ? "prepared" : "open"} label={l.action === "cast" ? "Cast" : "Buy"} /> <b>{l.label}</b>{l.need_by ? ` · needed from the week of ${fmtDay(l.need_by)}` : ""}</span>
          <span className="tabular-nums font-bold">{l.unit === "kg" ? kgText(l.quantity) : `${l.quantity} ${l.unit}`}</span></li>)}</ul> : <Empty>Nothing to buy or cast: stock and incoming cover the next {v.weeks} weeks.</Empty>}
        {v.approved ? <p className="text-sm">Approved by {v.approved.approved_by} on {new Date(v.approved.approved_at).toLocaleString("en-IN")}{v.approved.current ? "." : <span className="font-bold text-amber-800"> — requirements have changed since; review and approve again.</span>}</p> : null}
        {canApprove && v.lines.length && !(v.approved?.current) ? <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-xs font-bold">Note<input className={inputClass} value={note} onChange={e => setNote(e.target.value)} placeholder="Optional" /></label>
          <button type="button" className={buttonClass} onClick={async () => {
            const r = await fsWrite<{ state: string; message?: string }>("fs_mrp", "approve", { fingerprint: v.fingerprint, weeks: 8, ...(note.trim() ? { note: note.trim() } : {}) }, setMessage);
            if (r?.state === "stale") setMessage({ tone: "error", text: r.message ?? "The plan changed. Review it again." });
            else if (r) { setMessage({ tone: "ok", text: "Plan approved. Purchase and foundry are notified." }); setNote(""); }
            setKey(k => k + 1);
          }}>Approve this week&apos;s plan</button></div> : null}
      </Section>
      {v.approved ? <Actions plan={v.approved} onChange={() => setKey(k => k + 1)} /> : null}
      <Section title="Billet by alloy and diameter" description="Cumulative shortfall per week. Firm = live jobs; uncertain = order lines not yet on a job.">
        {v.billet.length ? <div className="space-y-3">{v.billet.map(b => <article key={b.line_key} className="rounded-xl border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold">{b.alloy} · {b.diameter_inch}&quot; billet <span className="font-normal text-neutral-600">· free {kgText(b.free_kg)}</span></p>
            <p className="text-sm">{b.action === "none" ? <Pill value="covered" label="Covered" /> : <><Pill value={b.action === "cast" ? "prepared" : "open"} label={b.action === "cast" ? "Cast" : "Buy"} /> <b>{kgText(b.suggest_kg)}</b>{b.suggest_billets ? ` (${b.suggest_billets} billets)` : ""}</>}</p></div>
          {b.action !== "none" ? <p className="text-xs text-neutral-600">{b.action_basis}. Firm shortfall {kgText(b.firm_shortfall_kg)}{b.firm_need_by ? ` from the week of ${fmtDay(b.firm_need_by)}` : ""}.</p> : null}
          <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[620px] text-xs">
            <thead className="text-left uppercase text-neutral-500"><tr><th className="p-1">Week</th><th className="p-1 text-right">Firm</th><th className="p-1 text-right">Uncertain</th><th className="p-1 text-right">Incoming</th><th className="p-1 text-right">Short (firm)</th><th className="p-1 text-right">Short (all)</th></tr></thead>
            <tbody>{b.weeks.map(w => <tr key={w.week_start} className="border-t"><td className="p-1">{fmtDay(w.week_start)}</td><td className="p-1 text-right tabular-nums">{kgText(w.firm_kg)}</td><td className="p-1 text-right tabular-nums text-neutral-500">{kgText(w.uncertain_kg)}</td>
              <td className="p-1 text-right tabular-nums">{kgText(w.incoming_kg)}</td><td className={`p-1 text-right tabular-nums ${w.firm_shortfall_kg > 0 ? "font-bold text-rose-700" : ""}`}>{kgText(w.firm_shortfall_kg)}</td>
              <td className={`p-1 text-right tabular-nums ${w.total_shortfall_kg > 0 ? "text-amber-800" : ""}`}>{kgText(w.total_shortfall_kg)}</td></tr>)}</tbody></table></div>
          <button type="button" className="mt-1 text-xs font-bold underline" onClick={() => setOpen(open === b.line_key ? null : b.line_key)}>{open === b.line_key ? "Hide" : `What drives it (${b.drivers.length})`}</button>
          {open === b.line_key ? <ul className="mt-1 space-y-0.5 text-xs">{b.drivers.map((x, k) => <li key={k}><Link className="underline" href={x.href}>{x.reference}</Link> · {fmtDay(x.week_start)} · {kgText(x.kg)} {x.firm ? "" : "(uncertain)"}</li>)}</ul> : null}
        </article>)}</div> : <Empty>No billet demand with a known alloy, diameter and input.</Empty>}
        {v.unknown.length ? <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><p className="font-bold">Cannot calculate ({v.unknown.length})</p>
          <ul className="mt-1 space-y-0.5 text-xs">{v.unknown.map((u, k) => <li key={k}><Link className="underline" href={u.href}>{u.reference}</Link> — missing {u.missing}</li>)}</ul></div> : null}
      </Section>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Packaging and consumables" description="At or below the reorder point.">
          {v.consumables.length ? <ul className="space-y-1 text-sm">{v.consumables.map(c => <li key={c.line_key} className="flex justify-between gap-2"><span className="min-w-0">{c.item_name} <span className="text-xs text-neutral-500">{c.item_code} · {c.current_stock} {c.unit} in stock, point {c.reorder_point}</span></span>
            <span className="tabular-nums font-bold">{c.suggest_quantity} {c.unit}</span></li>)}</ul> : <Empty>No consumable below its reorder point.</Empty>}
        </Section>
        <Section title="Dies due for replacement" description="From die life prediction.">
          {v.dies.length ? <ul className="space-y-1 text-sm">{v.dies.map(x => <li key={x.line_key}><Link className="font-bold underline" href="/dies/life">{x.die_number}</Link> {x.profile_code ?? ""} · remaining {kgText(x.remaining_kg)} vs demand {kgText(x.open_demand_kg)}{x.lead_days ? ` · lead ${x.lead_days} days` : ""}</li>)}</ul> : <Empty>No die is short of its demand.</Empty>}
        </Section>
      </div>
    </> : null}
    <History />
  </div>;
}

function Actions({ plan, onChange }: { plan: NonNullable<Plan["approved"]>; onChange: () => void }) {
  const [message, setMessage] = useState<Note>(null); const [form, setForm] = useState<Record<string, { action: string; reference: string; note: string }>>({});
  return <Section id="actions" title="Approved lines" description="Record the purchase order or cast against each line, or why it is not needed.">
    <Message value={message} />
    <ul className="divide-y rounded-xl border text-sm">{plan.lines.map(l => { const a = plan.actions[l.line_key]; const f = form[l.line_key] ?? { action: l.action === "cast" ? "cast_planned" : "po_raised", reference: "", note: "" };
      return <li key={l.line_key} className="space-y-2 p-3"><p><b>{l.label}</b> · {l.unit === "kg" ? kgText(l.quantity) : `${l.quantity} ${l.unit}`}</p>
        {a ? <p className="text-xs"><Pill value="posted" label={(MRP_ACTIONS as Record<string, string>)[a.action]} /> {a.reference ?? a.note} · {a.recorded_by}</p> : <div className="flex flex-wrap items-end gap-2">
          <select aria-label="What was done" className={`${inputClass} w-auto`} value={f.action} onChange={e => setForm(x => ({ ...x, [l.line_key]: { ...f, action: e.target.value } }))}>{Object.entries(MRP_ACTIONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select>
          {f.action === "not_needed" ? <input aria-label="Why not needed" className={`${inputClass} min-w-0 flex-1`} placeholder="Why it is not needed" value={f.note} onChange={e => setForm(x => ({ ...x, [l.line_key]: { ...f, note: e.target.value } }))} />
            : <input aria-label="Reference" className={`${inputClass} min-w-0 flex-1`} placeholder={f.action === "cast_planned" ? "Foundry batch number" : "Purchase order number"} value={f.reference} onChange={e => setForm(x => ({ ...x, [l.line_key]: { ...f, reference: e.target.value } }))} />}
          <button type="button" className={secondaryClass} disabled={f.action === "not_needed" ? f.note.trim().length < 3 : f.reference.trim().length < 2} onClick={async () => {
            if (await fsWrite("fs_mrp", "action", { plan_id: plan.id, line_key: l.line_key, action: f.action, ...(f.action === "not_needed" ? { note: f.note.trim() } : { reference: f.reference.trim() }) }, setMessage, "Recorded.")) onChange();
          }}>Record</button></div>}
      </li>; })}</ul>
  </Section>;
}

function History() {
  const [page, setPage] = useState(1);
  const d = useFsRead<{ rows: { id: string; week_start: string; status: string; approved_at: string; lines: number; approved_by: string; actioned: number }[]; total_count: number }>("fs_mrp", "history", { page }, []);
  return <Section id="history" title="Approved plans">
    {d.loading && !d.data ? <Loading what="plans" /> : d.error ? <Failure text={d.error} /> : d.data ? <>
      {d.data.rows.length ? <ul className="divide-y rounded-xl border text-sm">{d.data.rows.map(r => <li key={r.id} className="flex flex-wrap justify-between gap-2 p-2">
        <span>Week of {fmtDay(r.week_start)} · {r.approved_by} · {new Date(r.approved_at).toLocaleDateString("en-IN")}</span><span>{r.actioned}/{r.lines} actioned · <Pill value={r.status === "approved" ? "approved" : "superseded"} /></span></li>)}</ul> : <Empty>No plan approved yet.</Empty>}
      <Pager page={page} total={d.data.total_count} onPage={setPage} />
    </> : null}
  </Section>;
}
