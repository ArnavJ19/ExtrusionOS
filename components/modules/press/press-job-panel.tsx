"use client";

// AP-011 / AP-012 / AP-013 / AP-015 / AP-016 on the production job record: pushes and their billets, cycle time and
// runtime, the expected output with its engineering scrap (or what is missing, left blank), recovery after completion,
// the die change into the job, and sampling compliance. Supervisors void mistaken pushes or add missed ones with a reason.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { autopilotAction } from "@/lib/actions/autopilot";
import { fmtKg, fmtNum, fmtTime, type JobPressView } from "@/lib/press/types";
import { SAMPLING_KINDS } from "@/lib/press/press-floor";
import { ProposalCards } from "@/components/modules/autopilot/proposal-cards";

const FLOOR = ["owner", "admin", "factory_manager", "production_manager", "production"];
const SUPERVISOR = ["owner", "admin", "factory_manager", "production_manager"];

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="min-w-0 rounded-xl bg-neutral-50 p-3"><p className="text-xs font-bold uppercase tracking-wide text-neutral-500">{label}</p>
    <p className="mt-1 text-lg font-black tabular-nums [overflow-wrap:anywhere]">{value}</p>{note ? <p className="text-xs text-neutral-600">{note}</p> : null}</div>;
}

export function PressJobPanel({ jobId, role, today }: { jobId: string; role: string; today: string }) {
  const [view, setView] = useState<JobPressView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [prepared, setPrepared] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [backfill, setBackfill] = useState({ count: "1", reason: "" });
  const supervisor = SUPERVISOR.includes(role), floor = FLOOR.includes(role);

  const load = useCallback(async () => {
    const result = await autopilotAction("ap_press", "job", { job_id: jobId });
    if (!result.success) { setError(result.error); return; }
    setError(null); setView(result.data as JobPressView);
  }, [jobId]);
  useEffect(() => { void load(); }, [load]);

  async function prepare() {
    const result = await autopilotAction("ap_press", "expected", { job_id: jobId });
    if (!result.success) { setMessage(result.error); return; }
    const data = result.data as { state: string };
    setPrepared(data.state === "ready"); setReloadKey(key => key + 1);
    setMessage(data.state === "ready" ? null : "Expected output cannot be confirmed yet; see what is missing above.");
    await load();
  }
  async function voidPush(id: string) {
    const result = await autopilotAction("ap_press", "void", { push_id: id, reason: reason.trim() });
    setMessage(result.success ? "Push voided. Its billet is free for the next push." : result.error);
    if (result.success) { setVoiding(null); setReason(""); }
    await load();
  }
  async function addPushes() {
    const result = await autopilotAction("ap_press", "backfill", { job_id: jobId, count: Number(backfill.count), reason: backfill.reason.trim() });
    setMessage(result.success ? "Missing pushes recorded and marked as added by a supervisor." : result.error);
    if (result.success) setBackfill({ count: "1", reason: "" });
    await load();
  }

  if (error) return <section className="rounded-2xl border bg-white p-4"><h2 className="text-lg font-bold">Press capture</h2><p role="alert" className="mt-2 text-sm text-amber-900">{error}</p></section>;
  if (!view) return <section className="rounded-2xl border bg-white p-4"><p role="status" className="text-sm">Loading press capture…</p></section>;
  const e = view.expected, x = e.expected, running = view.status === "in_progress";
  return <section aria-labelledby="press-capture" className="min-w-0 space-y-4 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5">
    <div><h2 id="press-capture" className="text-lg font-bold">Press capture</h2>
      <p className="text-sm text-neutral-600">From one tap per billet at the press workstation. Expected values are labelled expected; confirmed output is what posts stock.</p></div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Stat label="Pushes" value={fmtNum(view.pushes.count)} note={`${view.pushes.voided} voided · ${view.pushes.backfilled} added by supervisor`} />
      <Stat label="Billet used" value={fmtKg(e.billet_kg)} note={e.input_basis === "linked_billets" ? `${e.linked_pushed} of ${e.linked_billets} linked billets` : e.estimated_pushes ? "Estimated weights" : undefined} />
      <Stat label="Cycle time (median)" value={view.cycle.median_seconds === null ? "—" : `${fmtNum(view.cycle.median_seconds)} s`} note={`${view.cycle.cycles} cycles · running ${fmtNum(view.cycle.running_seconds / 60)} min`} />
      <Stat label="Recovery" value={view.recovery_percent === null ? (x?.recovery_percent != null ? `${x.recovery_percent}% expected` : "—") : `${view.recovery_percent}%`}
        note={view.recovery_percent === null ? "Good output kg ÷ billet kg after completion" : "Actual output ÷ billet input"} />
    </div>
    {e.missing.length || e.blockers.length ? <ul className="list-disc space-y-1 rounded-xl bg-amber-50 p-3 pl-6 text-sm text-amber-950">{[...e.blockers, ...e.missing].map(item => <li key={item}>{item}</li>)}</ul> : null}
    {x ? <div className="overflow-x-auto"><table className="w-full min-w-[28rem] text-sm"><caption className="mb-1 text-left font-semibold">Expected from {e.pushes} pushes {e.standard ? `(scrap standard v${e.standard.version}, ${e.standard.scope})` : ""}</caption>
      <thead><tr className="text-left text-xs uppercase text-neutral-500"><th className="py-1">Part</th><th className="py-1 text-right">kg</th><th className="py-1">Basis</th></tr></thead>
      <tbody className="divide-y">
        <tr><td className="py-1.5 font-semibold">Good output (expected)</td><td className="text-right tabular-nums">{fmtKg(x.good_kg, 3)}</td><td>{x.good_pieces} pcs × {e.cut_m} m × {e.kg_per_m} kg/m{x.bundles ? ` · ${x.bundles.full} bundles of ${x.bundles.per_bundle}${x.bundles.loose ? ` + ${x.bundles.loose}` : ""}` : ""}</td></tr>
        <tr><td className="py-1.5">Butt end</td><td className="text-right tabular-nums">{fmtKg(x.butt_kg, 3)}</td><td>Engineering: {e.standard?.butt_length_mm} mm butt</td></tr>
        <tr><td className="py-1.5">Front / back crop</td><td className="text-right tabular-nums">{fmtKg(x.crop_kg, 3)}</td><td>Engineering: {e.standard?.front_crop_mm} + {e.standard?.back_crop_mm} mm</td></tr>
        <tr><td className="py-1.5">Saw kerf</td><td className="text-right tabular-nums">{fmtKg(x.saw_kg, 3)}</td><td>Engineering: {e.standard?.saw_kerf_mm} mm per cut</td></tr>
        <tr><td className="py-1.5">Cut-off remainder</td><td className="text-right tabular-nums">{fmtKg(x.cutoff_kg, 3)}</td><td>Engineering: what is left after whole pieces</td></tr>
      </tbody></table></div> : <p className="text-sm text-neutral-600">Expected output appears once pushes, the cut length, section weight and an approved scrap standard are all recorded. Missing values stay blank.</p>}
    {view.derivation ? <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-950">Closed from expected output: {view.derivation.good_pieces} pcs, {fmtKg(view.derivation.good_kg, 3)}; rejects {view.derivation.reject_pieces} pcs / {fmtKg(view.derivation.reject_kg, 3)}{view.derivation.reject_reason ? ` (${view.derivation.reject_reason.replaceAll("_", " ")})` : ""}. Engineering scrap was derived, not typed.</p> : null}
    {running && floor ? <div className="space-y-3">
      <button type="button" onClick={prepare} className="min-h-11 rounded-xl bg-neutral-950 px-4 text-sm font-bold text-white">{prepared ? "Refresh expected output" : "Prepare expected output to close the job"}</button>
      {prepared ? <ProposalCards type="production.expected_output" target={jobId} initial={null} today={today} reloadKey={reloadKey} onDecided={() => { void load(); }} title="Expected output" description="Confirm, or enter only rejects. The completion transaction re-checks billet mass balance." /> : null}
    </div> : null}
    {view.die_change ? <p className="text-sm">Die change into this job: {fmtNum(view.die_change.minutes, 1)} min from die {view.die_change.from_die ?? "—"} (derived from the press sequence).</p> : null}
    <div className="space-y-2"><h3 className="font-bold">Sampling compliance</h3>
      {view.sampling.required ? <p className="text-sm">{view.sampling.required} required · {view.sampling.on_time} on time · {view.sampling.late} late · {view.sampling.missed} missed · {view.sampling.open} open · {view.sampling.waived} waived
        {view.sampling.compliance_percent !== null ? ` · ${view.sampling.compliance_percent}% on time` : ""}{view.sampling.blocking_open ? <strong className="text-rose-700"> · QC release waits for {view.sampling.blocking_open} sample(s)</strong> : null}</p>
        : <p className="text-sm text-neutral-600">No samples required yet. Inspection plan triggers create them from pushes.</p>}
      {view.samples.length ? <ul className="divide-y rounded-xl border text-sm">{view.samples.map(sample => <li key={sample.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
        <span>{SAMPLING_KINDS[sample.kind as keyof typeof SAMPLING_KINDS] ?? sample.kind} · {sample.occurrence_key} · {fmtTime(sample.due_at)}</span>
        <Link className="font-semibold underline" href={`/quality/samples/${sample.id}`}>{sample.status === "recorded" ? (sample.recorded_late ? "Recorded late" : "Recorded") : sample.status === "missed" ? "Missed" : sample.status === "waived" ? "Waived" : "Due"}</Link></li>)}</ul> : null}
    </div>
    <div className="space-y-2"><h3 className="font-bold">Recent pushes</h3>
      {view.recent.length ? <div className="overflow-x-auto"><table className="w-full min-w-[30rem] text-sm"><thead><tr className="text-left text-xs uppercase text-neutral-500"><th>#</th><th>Time</th><th>Billet</th><th>By</th><th></th></tr></thead>
        <tbody className="divide-y">{view.recent.map(push => <tr key={push.id} className={push.voided ? "text-neutral-400 line-through" : ""}>
          <td className="py-1.5">{push.seq}</td><td>{fmtTime(push.at)}</td><td>{fmtKg(push.billet_kg, 3)}{push.basis === "estimated" ? " (est.)" : ""}</td>
          <td>{push.operator ?? "—"}{push.source === "backfill" ? " · added" : ""}</td>
          <td className="text-right">{supervisor && running && !push.voided ? <button type="button" className="min-h-9 rounded-lg border px-2 text-xs font-bold no-underline" onClick={() => setVoiding(voiding === push.id ? null : push.id)}>Void</button> : null}</td></tr>)}</tbody></table></div>
        : <p className="text-sm text-neutral-600">No pushes recorded for this job.</p>}
      {voiding ? <div className="flex flex-wrap items-end gap-2 rounded-xl bg-neutral-50 p-3"><label className="block min-w-0 flex-1 text-sm font-semibold">Why is this push wrong?<input className="mt-1 h-11 w-full rounded-xl border px-3" value={reason} maxLength={300} onChange={event => setReason(event.target.value)} /></label>
        <button type="button" disabled={reason.trim().length < 8} onClick={() => voidPush(voiding)} className="min-h-11 rounded-xl bg-rose-600 px-4 text-sm font-bold text-white disabled:opacity-50">Void push</button></div> : null}
      {supervisor && running ? <details className="rounded-xl border p-3 text-sm"><summary className="cursor-pointer font-semibold">Add pushes the station missed</summary>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="block w-28 font-semibold">Pushes<input inputMode="numeric" className="mt-1 h-11 w-full rounded-xl border px-3" value={backfill.count} onChange={event => setBackfill(b => ({ ...b, count: event.target.value.replace(/\D/g, "").slice(0, 2) }))} /></label>
          <label className="block min-w-0 flex-1 font-semibold">Reason<input className="mt-1 h-11 w-full rounded-xl border px-3" value={backfill.reason} maxLength={300} onChange={event => setBackfill(b => ({ ...b, reason: event.target.value }))} /></label>
          <button type="button" disabled={!Number(backfill.count) || backfill.reason.trim().length < 8} onClick={addPushes} className="min-h-11 rounded-xl bg-neutral-950 px-4 font-bold text-white disabled:opacity-50">Add</button></div>
        <p className="mt-1 text-xs text-neutral-600">Added pushes take the next linked billets, are marked as added, and are left out of cycle times.</p></details> : null}
    </div>
    {message ? <p role="status" className="rounded-xl bg-neutral-100 p-3 text-sm font-semibold">{message}</p> : null}
  </section>;
}
