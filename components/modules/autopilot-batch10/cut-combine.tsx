"use client";

// AP-067: one push pattern for several orders' cut lengths on the same die. The planner chooses jobs of a die that have
// not started; the system works out a pattern that needs fewer pushes than planning each job alone and shows which cuts
// in every push belong to which job. Order quantities and cut lengths are never changed.
import { useState } from "react";
import Link from "next/link";
import { prepareCutCombinationAction, type CutPrepared } from "@/lib/actions/autopilot-batch10";
import type { CutPattern } from "@/lib/calculations/cut-combination";
import { fmtDay, fmtWhen } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";

type Note = { tone: "ok" | "error"; text: string } | null;
type CutJob = { job_id: string; job_number: string | null; order_number: string | null; customer: string | null; machine_id: string | null; planned_date: string | null; cut_length_m: number; pieces: number; planned_kg: number | null };
type Candidate = { die_id: string; die_number: string; profile_code: string; jobs: number; cut_lengths: number; first_planned: string | null; job_list: CutJob[]; live: { id: string; status: string; combined_recovery: number; separate_recovery: number } | null };
type Inputs = { die_id: string; die_number: string; profile_code: string; kg_per_m: number | null; billet_diameter_mm: number | null; machine_id: string | null; machine_name: string | null; fingerprint: string; jobs: CutJob[];
  press: { min_billet_mm: number; max_billet_mm: number; standard_billet_mm: number | null; runout_m: number } | null; standard: { version: number; saw_kerf_mm: number } | null; presses: { machine_id: string; machine_name: string }[] };
export type Combination = { id: string; status: string; die_id: string; die_number: string; profile_code: string | null; machine_name: string | null; usable_m: number; kerf_mm: number; billet_mm: number | null; patterns: CutPattern[];
  separate_pushes: number; combined_pushes: number; separate_recovery: number; combined_recovery: number; jobs: CutJob[]; created_by: string | null; created_at: string; decided_by: string | null; decided_at: string | null; decision_note: string | null; stale: boolean; can_plan?: boolean };

const STATUS: Record<string, string> = { proposed: "Waiting for acceptance", accepted: "Accepted", superseded: "Replaced", cancelled: "Cancelled" };

function Patterns({ patterns, jobs }: { patterns: CutPattern[]; jobs: CutJob[] }) {
  const name = (id: string) => jobs.find(j => j.job_id === id)?.job_number ?? "job";
  return <ol className="divide-y rounded-xl border text-sm">{patterns.map((p, index) => <li key={index} className="p-3">
    <p><b>{p.pushes} push(es)</b>, each: {p.cuts.map(c => `${c.pieces} × ${c.length_m} m for ${name(c.job_id)}`).join(" + ")}</p>
    <p className="text-xs text-neutral-500">Uses {p.used_m} m of the push, {p.waste_m} m left over</p></li>)}</ol>;
}

export function CombinationView({ value, onChanged }: { value: Combination; onChanged?: () => void }) {
  const [note, setNote] = useState<Note>(null); const [reason, setReason] = useState("");
  async function act(command: string, payload: Record<string, unknown>, ok: string) { if (await apWrite("ap_cut_combine", command, payload, setNote, ok)) onChanged?.(); }
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm"><b>Die {value.die_number}</b> · {value.profile_code ?? "—"} · {value.machine_name ?? "press not set"} · billet {value.billet_mm ?? "—"} mm · usable {value.usable_m} m per push · saw kerf {value.kerf_mm} mm</p>
      <Pill value={value.status === "accepted" ? "approved" : value.status} label={STATUS[value.status] ?? value.status} /></div>
    <dl className="grid gap-2 sm:grid-cols-4">{[["Pushes combined", value.combined_pushes], ["Pushes separately", value.separate_pushes], ["Recovery combined", `${value.combined_recovery}%`], ["Recovery separately", `${value.separate_recovery}%`]].map(([l, v]) =>
      <div key={String(l)} className="rounded-xl bg-neutral-50 p-3"><dt className="text-xs font-bold uppercase text-neutral-500">{l}</dt><dd className="text-xl font-black tabular-nums">{v}</dd></div>)}</dl>
    <p className="text-xs text-neutral-500">Recovery here is cut length over extruded usable length; butt and crops are the same either way.</p>
    <Patterns patterns={value.patterns} jobs={value.jobs} />
    <div><h3 className="text-sm font-bold">Pieces by job (unchanged from the orders)</h3>
      <ul className="divide-y text-sm">{value.jobs.map(j => <li key={j.job_id} className="py-1.5"><Link className="font-bold underline" href={`/production/${j.job_id}`}>{j.job_number ?? "Job"}</Link> · {j.order_number ?? "—"} · {j.customer ?? "—"} · {j.pieces} pcs × {j.cut_length_m} m</li>)}</ul></div>
    {value.stale ? <Failure text="A job or the press settings changed since this pattern was prepared. Prepare it again before using it." /> : null}
    <p className="text-xs text-neutral-500">Prepared by {value.created_by ?? "—"} {fmtWhen(value.created_at)}{value.decided_by ? ` · ${STATUS[value.status] ?? value.status} by ${value.decided_by} ${fmtWhen(value.decided_at)}${value.decision_note ? `: ${value.decision_note}` : ""}` : ""}</p>
    {value.can_plan && ["proposed", "accepted"].includes(value.status) ? <div className="flex flex-wrap items-center gap-2">
      {value.status === "proposed" ? <button type="button" className={buttonClass} disabled={value.stale} onClick={() => act("accept", { id: value.id }, "Pattern accepted. Run these jobs to this pattern.")}>Accept pattern</button> : null}
      <input className={`${inputClass} sm:w-64`} placeholder="Reason to cancel" value={reason} maxLength={300} onChange={e => setReason(e.target.value)} />
      <button type="button" className={secondaryClass} disabled={reason.trim().length < 3} onClick={() => act("cancel", { id: value.id, note: reason.trim() }, "Pattern cancelled.")}>Cancel pattern</button></div> : null}
    <Message value={note} />
  </div>;
}

function Prepare({ die, onRecorded }: { die: Candidate; onRecorded: () => void }) {
  const [chosen, setChosen] = useState<string[]>(die.job_list.map(j => j.job_id)); const [machine, setMachine] = useState(""); const [billet, setBillet] = useState("");
  const inputs = useApRead<Inputs>("ap_cut_combine", "inputs", { die_id: die.die_id, job_ids: chosen, ...(machine ? { machine_id: machine } : {}) }, []);
  const [note, setNote] = useState<Note>(null); const [result, setResult] = useState<CutPrepared | null>(null); const [busy, setBusy] = useState(false);
  async function prepare() {
    if (!inputs.data) return;
    if (chosen.length < 2) { setNote({ tone: "error", text: "Choose at least two jobs of the die." }); return; }
    if (billet.trim() && !(Number(billet) > 0)) { setNote({ tone: "error", text: "Enter the billet length in mm." }); return; }
    setBusy(true); setResult(null);
    const out = await prepareCutCombinationAction({ die_id: die.die_id, job_ids: chosen, fingerprint: inputs.data.fingerprint, ...(inputs.data.machine_id ? { machine_id: inputs.data.machine_id } : {}), ...(billet.trim() ? { billet_mm: Number(billet) } : {}) });
    setBusy(false);
    if (!out.success) { setNote({ tone: "error", text: out.error }); return; }
    setResult(out.data); setNote({ tone: out.data.recorded ? "ok" : "error", text: out.data.message });
    if (out.data.recorded) onRecorded();
  }
  const d = inputs.data;
  return <div className="space-y-3 rounded-xl bg-neutral-50 p-3">
    <fieldset><legend className="text-sm font-bold">Jobs to combine</legend>
      <ul className="mt-1 divide-y">{die.job_list.map(j => <li key={j.job_id}><label className="flex min-h-11 items-center gap-3 py-1 text-sm"><input type="checkbox" className="h-5 w-5" checked={chosen.includes(j.job_id)}
        onChange={e => { setResult(null); setChosen(e.target.checked ? [...chosen, j.job_id] : chosen.filter(id => id !== j.job_id)); }} />
        <span><b>{j.job_number ?? "Job"}</b> · {j.order_number ?? "—"} · {j.customer ?? "—"} · {j.pieces} pcs × {j.cut_length_m} m{j.planned_date ? ` · planned ${fmtDay(j.planned_date)}` : ""}</span></label></li>)}</ul></fieldset>
    {inputs.loading && !d ? <Loading what="press settings" /> : inputs.error ? <Failure text={inputs.error} /> : d ? <>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-sm font-semibold">Press<select className={`${inputClass} mt-1`} value={d.machine_id ?? ""} onChange={e => { setMachine(e.target.value); setResult(null); }}>
          <option value="">{d.presses.length ? "Choose the press" : "No press has billet settings"}</option>{d.presses.map(p => <option key={p.machine_id} value={p.machine_id}>{p.machine_name}</option>)}</select></label>
        <label className="block text-sm font-semibold">Billet length (mm)<input inputMode="decimal" className={`${inputClass} mt-1`} value={billet} placeholder={d.press ? `${d.press.standard_billet_mm ?? d.press.max_billet_mm} (press ${d.press.standard_billet_mm ? "standard" : "longest"})` : ""} onChange={e => setBillet(e.target.value)} /></label>
      </div>
      <p className="text-xs text-neutral-500">{d.profile_code} at {d.kg_per_m ?? "?"} kg/m, billet diameter {d.billet_diameter_mm ? `${Math.round(Number(d.billet_diameter_mm))} mm` : "not set"}{d.press ? `, run-out ${d.press.runout_m} m` : ""}; saw kerf {d.standard ? `${d.standard.saw_kerf_mm} mm (scrap standard v${d.standard.version})` : "5 mm assumed"}.</p>
      <button type="button" className={buttonClass} disabled={busy || chosen.length < 2} onClick={prepare}>{busy ? "Working out..." : "Work out combined pattern"}</button>
    </> : null}
    <Message value={note} />
    {result && !result.recorded ? <p className="text-sm text-neutral-700">Separately: {result.comparison.separate.pushes} pushes at {result.comparison.separate.recovery_percent}% recovery. Combining gives the same number of pushes, so nothing was recorded.</p> : null}
  </div>;
}

export function CutCombineClient() {
  const [page, setPage] = useState(1); const [open, setOpen] = useState<string | null>(null); const [show, setShow] = useState<string | null>(null);
  const read = useApRead<{ rows: Candidate[]; total_count: number; can_plan: boolean }>("ap_cut_combine", "candidates", { page }, []);
  const [hpage, setHpage] = useState(1);
  const history = useApRead<{ rows: { id: string; status: string; die_number: string; profile_code: string | null; jobs: number; separate_pushes: number; combined_pushes: number; separate_recovery: number; combined_recovery: number; created_at: string; created_by: string | null }[]; total_count: number }>("ap_cut_combine", "list", { page: hpage }, []);
  const detail = useApRead<Combination>("ap_cut_combine", "get", { id: show ?? "00000000-0000-0000-0000-000000000000" }, [show]);
  const reload = () => { void read.reload(); void history.reload(); if (show) void detail.reload(); };
  return <div className="space-y-5">
    <Section title="Dies with several jobs waiting" description="Jobs of the same die that are planned or ready and have not started pressing. Ten dies per page.">
      {read.loading && !read.data ? <Loading what="dies" /> : read.error ? <Failure text={read.error} /> : read.data ? <>
        {read.data.rows.length ? <ul className="space-y-3">{read.data.rows.map(c => <li key={c.die_id} className="space-y-2 rounded-xl border border-neutral-200 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><p><b>Die {c.die_number}</b> · {c.profile_code} · {c.jobs} jobs, {c.cut_lengths} cut length(s){c.first_planned ? ` · first planned ${fmtDay(c.first_planned)}` : ""}</p>
            <span className="flex flex-wrap gap-2">{c.live ? <button type="button" className={secondaryClass} onClick={() => setShow(c.live!.id)}>{STATUS[c.live.status]}: {c.live.combined_recovery}% against {c.live.separate_recovery}%</button> : null}
              {read.data!.can_plan ? <button type="button" className={buttonClass} onClick={() => setOpen(open === c.die_id ? null : c.die_id)}>{open === c.die_id ? "Close" : "Combine"}</button> : null}</span></div>
          {open === c.die_id ? <Prepare die={c} onRecorded={reload} /> : null}
        </li>)}</ul> : <Empty>No die has two or more jobs waiting to press.</Empty>}
        <Pager page={page} total={read.data.total_count} onPage={setPage} />
      </> : null}
    </Section>
    {show ? <Section id="pattern" title="Combined pattern" actions={<button type="button" className={secondaryClass} onClick={() => setShow(null)}>Close</button>}>
      {detail.loading && !detail.data ? <Loading what="the pattern" /> : detail.error ? <Failure text={detail.error} /> : detail.data ? <CombinationView value={detail.data} onChanged={reload} /> : null}
    </Section> : null}
    <Section title="Combined patterns" description="Ten per page, newest first.">
      {history.loading && !history.data ? <Loading what="patterns" /> : history.error ? <Failure text={history.error} /> : history.data ? <>
        {history.data.rows.length ? <ul className="divide-y rounded-xl border">{history.data.rows.map(r => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
          <span><b>Die {r.die_number}</b> · {r.profile_code ?? "—"} · {r.jobs} jobs · {r.combined_pushes} pushes against {r.separate_pushes} · {r.combined_recovery}% against {r.separate_recovery}% · {STATUS[r.status] ?? r.status} · {r.created_by ?? "—"} {fmtWhen(r.created_at)}</span>
          <button type="button" className="min-h-11 text-sm font-bold underline" onClick={() => setShow(r.id)}>Open</button></li>)}</ul> : <Empty>No combined pattern yet.</Empty>}
        <Pager page={hpage} total={history.data.total_count} onPage={setHpage} />
      </> : null}
    </Section>
  </div>;
}

/** On the job record: the combined pattern this job is part of, if any. */
export function JobCutPanel({ jobId }: { jobId: string }) {
  const read = useApRead<{ combination: Combination | null }>("ap_cut_combine", "job", { job_id: jobId }, []);
  if (!read.data?.combination) return null;
  return <Section id="combined-cut" title="Combined cut pattern" description="This job shares pushes with other jobs of the same die. Its pieces and cut length are unchanged."
    actions={<Link href="/production/cutting/combine" className="text-sm font-bold underline">All combined patterns</Link>}>
    <CombinationView value={read.data.combination} />
  </Section>;
}
