"use client";

// FS-16: predicted remaining die life against open demand and the replacement lead time; open correction loops; die
// makers ranked by life per rupee; amortisation recovered on customer-owned dies. Prediction is advisory.
import { useState } from "react";
import Link from "next/link";
import { fmtDay, inr } from "@/lib/order-to-cash/commands";
import { DIE_DEFECTS } from "@/lib/intelligence/commands";
import { kgText, pct } from "@/lib/intelligence/format";
import { correctionPhotoUrlAction } from "@/lib/actions/intelligence";
import { uploadTenantFile } from "@/lib/utils/files";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, buttonClass, fsWrite, inputClass, secondaryClass, useFsRead, type Note } from "./shared";

export type DieLoopRights = { companyId: string; canReport: boolean; canCorrect: boolean; canDecide: boolean };

type Die = { die_id: string; die_number: string; profile_code: string | null; die_type: string | null; die_status: string; ownership_type: string | null; maker: string;
  used_kg: number; life_kg: number | null; life_basis: string; remaining_kg: number | null; weekly_kg: number; weeks_left: number | null; open_demand_kg: number;
  lead_days: number | null; lead_basis: string; replace_flag: boolean; replace_reason: string | null; open_corrections: number; oldest_open_correction_days: number | null;
  last_correction_result: string | null; die_cost?: number | null; recovered_amount?: number | null; rack_location: string | null };
const FILTERS: Record<string, string> = { all: "All active dies", replace: "Order a replacement", unknown_life: "Life not known", open_corrections: "Open corrections", customer_owned: "Customer-owned" };

export function DieLifeClient({ canSetLead, canSeeMakers, loop }: { canSetLead: boolean; canSeeMakers: boolean; loop: DieLoopRights }) {
  const [page, setPage] = useState(1); const [filter, setFilter] = useState("all"); const [search, setSearch] = useState(""); const [key, setKey] = useState(0); const [open, setOpen] = useState<string | null>(null);
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
          <button type="button" className="text-xs font-bold underline" onClick={() => setOpen(open === x.die_id ? null : x.die_id)}>{open === x.die_id ? "Hide history" : "History and corrections"}</button>
          {open === x.die_id ? <DieHistory dieId={x.die_id} loop={loop} onChange={() => setKey(k => k + 1)} /> : null}
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

type Step = { id: string; step: string; note: string; has_photo: boolean; trial_result: string | null; by: string; at: string };
type Correction = { id: string; date: string; reason: string; vendor: string | null; result: string | null; stage: string; steps: Step[] };
type History = { runs: { job_id: string; job_number: string | null; completed_on: string; output_kg: number; input_kg: number | null; recovery_percent: number | null; kg_per_hour: number | null; pushes: number }[];
  averages: { runs: number; recovery_percent: number | null }; corrections: Correction[]; nitriding: { date: string; vendor: string | null; cycle: number | null; status: string | null }[];
  trials: { id: string; date: string; result: string; recovery_percent: number | null; remarks: string | null }[] };
const STEP_LABEL: Record<string, string> = { defect: "Defect reported", action: "Corrected", trial: "Trial", approved: "Approved", returned: "Sent back for correction" };

/** FS-16: the die's recent runs, nitriding and trials, and its correction loop with the next allowed step. */
export function DieHistory({ dieId, loop, onChange }: { dieId: string; loop: DieLoopRights; onChange: () => void }) {
  const [key, setKey] = useState(0); const [message, setMessage] = useState<Note>(null);
  const h = useFsRead<History>("fs_die_life", "history", { die_id: dieId }, [key]);
  const done = (text: string) => { setMessage({ tone: "ok", text }); setKey(k => k + 1); onChange(); };
  if (h.loading && !h.data) return <Loading what="the die history" />;
  if (h.error) return <Failure text={h.error} />;
  if (!h.data) return null;
  const v = h.data; const open = v.corrections.find(c => c.result === "pending" || c.result === null);
  return <div className="space-y-3 rounded-xl bg-neutral-50 p-3 text-sm">
    <Message value={message} />
    <div><p className="font-bold">Recent runs <span className="font-normal text-neutral-600">· {v.averages.runs} completed, average recovery {pct(v.averages.recovery_percent)}</span></p>
      {v.runs.length ? <div className="mt-1 overflow-x-auto"><table className="w-full min-w-[520px] text-xs"><thead className="text-left uppercase text-neutral-500"><tr><th className="p-1">Done</th><th className="p-1">Job</th><th className="p-1 text-right">Output</th><th className="p-1 text-right">Recovery</th><th className="p-1 text-right">kg/h</th></tr></thead>
        <tbody>{v.runs.map(r => <tr key={r.job_id} className="border-t"><td className="p-1">{fmtDay(r.completed_on)}</td><td className="p-1"><Link className="underline" href={`/production/${r.job_id}`}>{r.job_number ?? "Job"}</Link></td>
          <td className="p-1 text-right tabular-nums">{kgText(r.output_kg)}</td><td className="p-1 text-right tabular-nums">{pct(r.recovery_percent)}</td><td className="p-1 text-right tabular-nums">{r.kg_per_hour ?? "—"}</td></tr>)}</tbody></table></div> : <p className="text-xs text-neutral-600">No completed runs.</p>}</div>
    <p className="text-xs">Nitriding: {v.nitriding.length ? v.nitriding.slice(0, 3).map(n => `${fmtDay(n.date)}${n.vendor ? ` (${n.vendor})` : ""}`).join(", ") : "none recorded"} · Trials: {v.trials.length ? v.trials.slice(0, 3).map(t => `${fmtDay(t.date)} ${t.result}`).join(", ") : "none recorded"}</p>
    <div className="space-y-2"><p className="font-bold">Corrections</p>
      {v.corrections.length ? v.corrections.map(c => <article key={c.id} className="rounded-lg bg-white p-2">
        <p className="text-xs"><b>{(DIE_DEFECTS as Record<string, string>)[c.reason] ?? c.reason}</b> · {fmtDay(c.date)}{c.vendor ? ` · ${c.vendor}` : ""} · <Pill value={c.result === "pending" || !c.result ? "open" : c.result === "failed" ? "rejected" : "approved"} label={c.result === "pending" || !c.result ? STEP_LABEL[c.stage] ?? "Open" : c.result} /></p>
        <ol className="mt-1 space-y-0.5 text-xs">{c.steps.map(s => <li key={s.id}>{STEP_LABEL[s.step]}{s.trial_result ? ` (${s.trial_result})` : ""} · {s.by} · {new Date(s.at).toLocaleString("en-IN")} — {s.note}{s.has_photo ? <> · <PhotoLink stepId={s.id} /></> : null}</li>)}</ol>
      </article>) : <p className="text-xs text-neutral-600">No corrections recorded.</p>}
      {open ? <LoopStep correction={open} dieId={dieId} trials={v.trials} loop={loop} setMessage={setMessage} done={done} />
        : loop.canReport ? <ReportDefect dieId={dieId} companyId={loop.companyId} setMessage={setMessage} done={done} /> : null}
    </div>
  </div>;
}

function PhotoLink({ stepId }: { stepId: string }) {
  const [error, setError] = useState<string | null>(null);
  return <><button type="button" className="font-bold underline" onClick={async () => { const r = await correctionPhotoUrlAction(stepId); if (r.success) window.open(r.data.url, "_blank", "noopener,noreferrer"); else setError(r.error); }}>Photo</button>{error ? <span className="text-rose-700"> {error}</span> : null}</>;
}

async function uploadPhoto(companyId: string, dieId: string, file: File | null) {
  return file ? uploadTenantFile("documents", companyId, `die-corrections/${dieId}`, file) : undefined;
}

function ReportDefect({ dieId, companyId, setMessage, done }: { dieId: string; companyId: string; setMessage: (m: Note) => void; done: (t: string) => void }) {
  const [reason, setReason] = useState(""); const [note, setNote] = useState(""); const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false);
  return <div className="flex flex-wrap items-end gap-2">
    <label className="text-xs font-bold">Defect<select className={`${inputClass} w-auto`} value={reason} onChange={e => setReason(e.target.value)}><option value="">Choose…</option>{Object.entries(DIE_DEFECTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
    <label className="min-w-0 flex-1 text-xs font-bold">What was seen<input className={inputClass} value={note} onChange={e => setNote(e.target.value)} /></label>
    <label className="text-xs font-bold">Photo<input type="file" accept="image/*" capture="environment" className="block text-xs" onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>
    <button type="button" className={buttonClass} disabled={!reason || note.trim().length < 3 || busy} onClick={async () => {
      setBusy(true);
      try { const photo_path = await uploadPhoto(companyId, dieId, file);
        if (await fsWrite("fs_die_life", "report_defect", { die_id: dieId, reason, note: note.trim(), ...(photo_path ? { photo_path } : {}) }, setMessage)) { setNote(""); setFile(null); done("Defect reported; the die shop is notified."); }
      } catch { setMessage({ tone: "error", text: "The photo could not be uploaded. Retry or report without it." }); } finally { setBusy(false); }
    }}>Report defect</button></div>;
}

function LoopStep({ correction, dieId, trials, loop, setMessage, done }: { correction: Correction; dieId: string; trials: History["trials"]; loop: DieLoopRights; setMessage: (m: Note) => void; done: (t: string) => void }) {
  const [note, setNote] = useState(""); const [vendor, setVendor] = useState(""); const [cost, setCost] = useState(""); const [file, setFile] = useState<File | null>(null); const [trial, setTrial] = useState(""); const [busy, setBusy] = useState(false);
  if (["defect", "returned"].includes(correction.stage)) {
    if (!loop.canCorrect) return <p className="text-xs text-neutral-600">Waiting for the die shop to record the correction.</p>;
    return <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 flex-1 text-xs font-bold">What was corrected<input className={inputClass} value={note} onChange={e => setNote(e.target.value)} /></label>
      <label className="text-xs font-bold">Corrector<input className={`${inputClass} w-40`} value={vendor} onChange={e => setVendor(e.target.value)} /></label>
      <label className="text-xs font-bold">Cost ₹<input className={`${inputClass} w-28`} inputMode="decimal" value={cost} onChange={e => setCost(e.target.value)} /></label>
      <label className="text-xs font-bold">Photo<input type="file" accept="image/*" className="block text-xs" onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>
      <button type="button" className={buttonClass} disabled={note.trim().length < 3 || busy} onClick={async () => {
        setBusy(true);
        try { const photo_path = await uploadPhoto(loop.companyId, dieId, file);
          if (await fsWrite("fs_die_life", "record_action", { correction_id: correction.id, note: note.trim(), ...(vendor.trim() ? { vendor: vendor.trim() } : {}), ...(cost.trim() ? { cost: Number(cost) } : {}), ...(photo_path ? { photo_path } : {}) }, setMessage)) done("Correction recorded. Run a trial and record its result.");
        } catch { setMessage({ tone: "error", text: "The photo could not be uploaded. Retry or save without it." }); } finally { setBusy(false); }
      }}>Record correction</button></div>;
  }
  if (correction.stage === "action") {
    if (!loop.canDecide) return <p className="text-xs text-neutral-600">Waiting for the trial result.</p>;
    const options = trials.filter(t => t.result !== "pending");
    return <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 flex-1 text-xs font-bold">Trial on this die<select className={inputClass} value={trial} onChange={e => setTrial(e.target.value)}><option value="">Choose the trial…</option>{options.map(t => <option key={t.id} value={t.id}>{fmtDay(t.date)} · {t.result}{t.recovery_percent !== null ? ` · ${t.recovery_percent}%` : ""}</option>)}</select></label>
      <button type="button" className={buttonClass} disabled={!trial} onClick={async () => { if (await fsWrite("fs_die_life", "record_trial", { correction_id: correction.id, trial_id: trial }, setMessage)) done("Trial linked."); }}>Link trial result</button>
      <Link className="text-xs font-bold underline" href={`/dies/${dieId}`}>Record a trial on the die</Link></div>;
  }
  if (correction.stage === "trial") {
    if (!loop.canDecide) return <p className="text-xs text-neutral-600">Waiting for quality to approve or send back.</p>;
    return <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 flex-1 text-xs font-bold">Decision note<input className={inputClass} value={note} onChange={e => setNote(e.target.value)} /></label>
      <button type="button" className={buttonClass} disabled={note.trim().length < 3} onClick={async () => { if (await fsWrite("fs_die_life", "decide", { correction_id: correction.id, decision: "approved", note: note.trim() }, setMessage)) done("Correction approved."); }}>Approve</button>
      <button type="button" className={secondaryClass} disabled={note.trim().length < 3} onClick={async () => { if (await fsWrite("fs_die_life", "decide", { correction_id: correction.id, decision: "returned", note: note.trim() }, setMessage)) done("Sent back for another correction."); }}>Send back</button></div>;
  }
  return null;
}
