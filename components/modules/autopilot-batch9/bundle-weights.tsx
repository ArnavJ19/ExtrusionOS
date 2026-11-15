"use client";

// AP-010: how bundle weights were captured (packing scale or typed) and which bundles were outside the approved
// section-weight tolerance against theoretical (metres x kg/m). Read-only; the bundle record is never changed here.
import { useState } from "react";
import { fmtWhen } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Pager, Section, inputClass, useApRead } from "../order-to-cash/ui";

type Row = { id: string; bundle_id: string; bundle_number: string; source: string; indicator_ref: string | null; raw_reading: string | null; gross_kg: number; tare_kg: number; net_kg: number;
  theoretical_kg: number | null; tolerance_percent: number | null; deviation_percent: number | null; flagged: boolean; recorded_by_name: string | null; recorded_at: string };
const kg = (v: unknown) => (v === null || v === undefined ? "—" : `${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg`);

export function BundleWeightsClient() {
  const [days, setDays] = useState(30); const [show, setShow] = useState("flagged"); const [page, setPage] = useState(1);
  const share = useApRead<{ days: number; total: number; scale: number; manual: number; flagged: number; unjudged: number; scale_share_percent: number | null }>("ap_scale", "share", { days }, []);
  const list = useApRead<{ rows: Row[]; total_count: number }>("ap_scale", "list", { page, show }, []);
  const s = share.data;
  return <div className="space-y-5">
    <Section title="Scale and typed weights" description="Share of bundle weights read from the packing scale, and bundles outside the approved tolerance.">
      <select aria-label="Period" className={`${inputClass} w-auto`} value={days} onChange={e => setDays(Number(e.target.value))}>{[7, 30, 90].map(d => <option key={d} value={d}>Last {d} days</option>)}</select>
      {share.loading && !s ? <Loading what="the share" /> : share.error ? <Failure text={share.error} /> : s ? <dl className="grid gap-2 sm:grid-cols-5">
        {[["Bundles", s.total], ["From scale", s.scale], ["Typed", s.manual], ["Out of tolerance", s.flagged], ["Not judged", s.unjudged]].map(([l, v]) => <div key={String(l)} className="rounded-xl bg-neutral-50 p-3"><dt className="text-xs font-bold uppercase text-neutral-500">{l}</dt><dd className="text-2xl font-black tabular-nums">{v}</dd></div>)}
      </dl> : null}
      {s && s.total ? <p className="text-sm">{s.scale_share_percent ?? 0}% of bundles were weighed on the scale. “Not judged” bundles have no approved tolerance or no section weight on the profile.</p> : null}
    </Section>
    <Section title="Bundles" description="Ten per page, newest first.">
      <select aria-label="Show" className={`${inputClass} w-auto`} value={show} onChange={e => { setShow(e.target.value); setPage(1); }}><option value="flagged">Out of tolerance</option><option value="manual">Typed weights</option><option value="all">All</option></select>
      {list.loading && !list.data ? <Loading what="bundles" /> : list.error ? <Failure text={list.error} /> : list.data ? <>
        {list.data.rows.length ? <ul className="divide-y rounded-xl border">{list.data.rows.map(r => <li key={r.id} className="p-3 text-sm">
          <p><b>{r.bundle_number}</b> · net {kg(r.net_kg)} (gross {kg(r.gross_kg)} − tare {kg(r.tare_kg)}) · {r.source === "scale" ? "from scale" : "typed"}{r.flagged ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">{r.deviation_percent}% from theoretical</span> : null}</p>
          <p className="text-xs text-neutral-500">Theoretical {kg(r.theoretical_kg)}{r.tolerance_percent !== null ? ` · tolerance ${r.tolerance_percent}%` : " · no approved tolerance"}{r.raw_reading ? ` · indicator “${r.raw_reading}”` : ""}{r.indicator_ref ? ` (${r.indicator_ref})` : ""} · {r.recorded_by_name ?? "—"} {fmtWhen(r.recorded_at)}</p></li>)}</ul>
          : <Empty>{show === "flagged" ? "No bundle outside tolerance." : "No bundle weights recorded."}</Empty>}
        <Pager page={page} total={list.data.total_count} onPage={setPage} />
      </> : null}
    </Section>
  </div>;
}
