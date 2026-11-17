"use client";

// FS-16: predicted remaining die life against open demand and the replacement lead time; open correction loops; die
// makers ranked by life per rupee; amortisation recovered on customer-owned dies. Prediction is advisory.
import { useState } from "react";
import Link from "next/link";
import { inr } from "@/lib/order-to-cash/commands";
import { kgText } from "@/lib/intelligence/format";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, buttonClass, fsWrite, inputClass, useFsRead, type Note } from "./shared";

type Die = { die_id: string; die_number: string; profile_code: string | null; die_type: string | null; die_status: string; ownership_type: string | null; maker: string;
  used_kg: number; life_kg: number | null; life_basis: string; remaining_kg: number | null; weekly_kg: number; weeks_left: number | null; open_demand_kg: number;
  lead_days: number | null; lead_basis: string; replace_flag: boolean; replace_reason: string | null; open_corrections: number; oldest_open_correction_days: number | null;
  last_correction_result: string | null; die_cost?: number | null; recovered_amount?: number | null; rack_location: string | null };
const FILTERS: Record<string, string> = { all: "All active dies", replace: "Order a replacement", unknown_life: "Life not known", open_corrections: "Open corrections", customer_owned: "Customer-owned" };

export function DieLifeClient({ canSetLead, canSeeMakers }: { canSetLead: boolean; canSeeMakers: boolean }) {
  const [page, setPage] = useState(1); const [filter, setFilter] = useState("all"); const [search, setSearch] = useState(""); const [key, setKey] = useState(0);
  const d = useFsRead<{ rows: Die[]; total_count: number; flagged: number; basis: string }>("fs_die_life", "dies", { page, filter, ...(search.trim() ? { search: search.trim() } : {}) }, [key]);
  return <div className="space-y-5">
    <Section title="Die life" description={d.data?.basis ?? "Remaining life against open demand."}>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Filter" className={`${inputClass} w-auto`} value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}>{Object.entries(FILTERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input aria-label="Search die or profile" className={`${inputClass} w-56`} placeholder="Die or profile" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
      </div>
      {d.loading && !d.data ? <Loading what="dies" /> : d.error ? <Failure text={d.error} /> : d.data ? <>
        {d.data.flagged ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800">{d.data.flagged} die(s) need a replacement ordered.</p> : null}
        {d.data.rows.length ? <ul className="divide-y rounded-xl border">{d.data.rows.map(x => <li key={x.die_id} className="space-y-1 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><p><Link className="font-bold underline" href={`/dies/${x.die_id}`}>{x.die_number}</Link> {x.profile_code ? `· ${x.profile_code}` : ""} · {x.maker}{x.rack_location ? ` · rack ${x.rack_location}` : ""}</p>
            {x.replace_flag ? <Pill value="blocked" label="Order a replacement" /> : x.life_kg === null ? <Pill value="unknown" label="Life not known" /> : <Pill value="passed" label="Covered" />}</div>
          <p className="text-xs text-neutral-700">Used {kgText(x.used_kg)}{x.life_kg !== null ? ` of ${kgText(x.life_kg)} · remaining ${kgText(x.remaining_kg)}` : ""} · {kgText(x.weekly_kg)}/week{x.weeks_left !== null ? ` · about ${x.weeks_left} weeks left` : ""} · open demand {kgText(x.open_demand_kg)}</p>
          <p className="text-xs text-neutral-500">Life: {x.life_basis}. Lead time: {x.lead_days ? `${x.lead_days} days (${x.lead_basis})` : x.lead_basis}.{x.replace_reason ? ` ${x.replace_reason}.` : ""}</p>
          {x.open_corrections ? <p className="text-xs text-amber-800">{x.open_corrections} correction(s) awaiting a trial result, oldest {x.oldest_open_correction_days} days.</p> : x.last_correction_result ? <p className="text-xs text-neutral-500">Last correction: {x.last_correction_result}.</p> : null}
          {x.recovered_amount !== undefined && x.recovered_amount !== null ? <p className="text-xs">Die cost {x.die_cost !== null && x.die_cost !== undefined ? inr(x.die_cost) : "not recorded"} · recovered on invoices {inr(x.recovered_amount)}{x.die_cost ? ` · outstanding ${inr(Math.max(0, Number(x.die_cost) - Number(x.recovered_amount)))}` : ""}</p> : null}
        </li>)}</ul> : <Empty>No dies match.</Empty>}
        <Pager page={page} total={d.data.total_count} onPage={setPage} />
      </> : null}
    </Section>
    {canSeeMakers ? <Makers /> : null}
    {canSetLead ? <LeadTime onSaved={() => setKey(k => k + 1)} /> : null}
  </div>;
}

function Makers() {
  const d = useFsRead<{ rows: { maker: string; dies: number; retired: number; total_kg: number; average_retired_life_kg: number | null; costed_dies: number; kg_per_1000_inr: number | null }[]; basis: string }>("fs_die_life", "makers", {}, []);
  return <Section id="makers" title="Die makers" description={d.data?.basis}>
    {d.loading && !d.data ? <Loading what="die makers" /> : d.error ? <Failure text={d.error} /> : d.data?.rows.length ? <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[620px] text-sm">
      <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500"><tr><th className="p-2">Maker</th><th className="p-2 text-right">Dies</th><th className="p-2 text-right">Retired</th><th className="p-2 text-right">Average retired life</th><th className="p-2 text-right">kg per ₹1,000</th></tr></thead>
      <tbody>{d.data.rows.map(r => <tr key={r.maker} className="border-t"><td className="p-2">{r.maker}</td><td className="p-2 text-right">{r.dies}</td><td className="p-2 text-right">{r.retired}</td>
        <td className="p-2 text-right tabular-nums">{r.average_retired_life_kg === null ? "—" : kgText(r.average_retired_life_kg)}</td><td className="p-2 text-right font-bold tabular-nums">{r.kg_per_1000_inr ?? `— (${r.costed_dies} costed)`}</td></tr>)}</tbody>
    </table></div> : <Empty>No dies recorded.</Empty>}
  </Section>;
}

function LeadTime({ onSaved }: { onSaved: () => void }) {
  const [message, setMessage] = useState<Note>(null); const [days, setDays] = useState(""); const [reason, setReason] = useState(""); const [key, setKey] = useState(0);
  const s = useFsRead<{ replacement_lead_days: number | null; reason?: string; updated_by_name?: string }>("fs_die_life", "settings", {}, [key]);
  return <Section id="lead" title="Replacement lead time" description="Used only for a die whose maker has fewer than two recorded order-to-receipt dates. Blank clears it.">
    <Message value={message} />
    {s.data ? <p className="text-sm">Now {s.data.replacement_lead_days ? `${s.data.replacement_lead_days} days` : "not set"}{s.data.updated_by_name ? ` · set by ${s.data.updated_by_name} (“${s.data.reason}”)` : ""}.</p> : null}
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs font-bold">Days<input className={`${inputClass} w-24`} inputMode="numeric" value={days} onChange={e => setDays(e.target.value)} /></label>
      <label className="min-w-0 flex-1 text-xs font-bold">Reason<input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <button type="button" className={buttonClass} disabled={reason.trim().length < 5} onClick={async () => {
        const r = await fsWrite<{ new_alerts: number }>("fs_die_life", "save_settings", { ...(days.trim() ? { replacement_lead_days: Number(days) } : {}), reason: reason.trim() }, setMessage);
        if (r) { setMessage({ tone: "ok", text: `Saved. ${r.new_alerts} new replacement warning(s).` }); setReason(""); setKey(k => k + 1); onSaved(); }
      }}>Save</button></div>
  </Section>;
}
