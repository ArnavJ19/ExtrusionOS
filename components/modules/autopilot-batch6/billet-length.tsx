"use client";

import { useCallback, useEffect, useState } from "react";
import { billetOptionsAction, chooseBilletLengthAction, type BilletOptions } from "@/lib/actions/autopilot-batch6";
import { fmtWhen } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Section, useApRead } from "../order-to-cash/ui";
import { Action, Field, NumberInput, Stat, Why, num, optional, write, type Note } from "./shared";

export function BilletLengthPanel({ jobId, canChoose }: { jobId: string; canChoose: boolean }) {
  const [data, setData] = useState<BilletOptions | null>(null); const [error, setError] = useState<string | null>(null); const [note, setNote] = useState<Note>(null);
  const load = useCallback(async () => { const r = await billetOptionsAction(jobId); if (r.success) { setData(r.data); setError(null); } else setError(r.error); }, [jobId]);
  useEffect(() => { void load(); }, [load]);
  const current = data?.inputs.current as { chosen_mm: number; chosen_recovery: number | null; standard_recovery: number | null; chosen_by: string | null; chosen_at: string } | null | undefined;
  return <Section id="billet-length" title="Billet length for best recovery" description="Options within the press's billet limits for this job's cut length. The planner picks one; the choice is recorded on the job.">
    {error ? <Failure text={error} /> : !data ? <Loading what="billet options" /> : <>
      <p className="text-xs text-neutral-600">Cut length {num(data.inputs.cut_length_m)} m · section {num(data.inputs.kg_per_m, 4)} kg/m · billet Ø {num(data.inputs.billet_diameter_mm, 1)} mm{data.inputs.extrusion_ratio ? ` · extrusion ratio ${num(data.inputs.extrusion_ratio, 1)}` : ""} · die {data.inputs.die_number ?? "—"}</p>
      {current ? <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">Chosen: {num(current.chosen_mm, 1)} mm (recovery {num(current.chosen_recovery, 2)}%{current.standard_recovery != null ? ` against ${num(current.standard_recovery, 2)}% at the standard length` : ""}) by {current.chosen_by ?? "—"} {fmtWhen(current.chosen_at)}.</p> : null}
      <Message value={note} />
      {data.plans.map(({ press, plan }, index) => <article key={press?.machine_id ?? index} className="min-w-0 rounded-xl border p-3">
        <h3 className="font-bold">{press?.machine_name ?? "No press limits set"}</h3>
        {!plan.ok ? <Empty>{plan.message}</Empty> : <>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat label="Recommended" value={`${num(plan.recommended.billet_mm, 1)} mm`} /><Stat label="Recovery" value={`${num(plan.recommended.recovery_percent, 2)}%`} tone="ok" />
            <Stat label="Pieces per push" value={plan.recommended.pieces} /><Stat label="Gain over standard" value={plan.gain_vs_standard == null ? plan.standard_unusable ? "Standard does not fit this press" : "No standard length" : `${plan.gain_vs_standard >= 0 ? "+" : ""}${num(plan.gain_vs_standard, 2)} points`} tone={plan.gain_vs_standard && plan.gain_vs_standard > 0 ? "ok" : undefined} /></div>
          <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr className="border-b text-xs text-neutral-500"><th className="py-2">Billet</th><th>Option</th><th>Pieces</th><th>Extruded</th><th>End scrap</th><th>Recovery</th><th /></tr></thead><tbody>
            {plan.options.map(o => <tr key={o.billet_mm} className="border-b"><td className="py-2 font-semibold">{num(o.billet_mm, 1)} mm</td><td>{o.label}</td><td>{o.pieces}</td><td>{num(o.extruded_m, 2)} m</td><td>{num(o.end_scrap_m, 2)} m</td><td>{num(o.recovery_percent, 2)}%</td>
              <td>{canChoose ? <Action secondary label={`Use ${o.billet_mm} mm`} run={async () => { const r = await chooseBilletLengthAction({ jobId, machineId: press.machine_id, chosenMm: o.billet_mm }); setNote(r.success ? { tone: "ok", text: `${o.billet_mm} mm recorded for this job.` } : { tone: "error", text: r.error }); if (r.success) await load(); }}>Use</Action> : null}</td></tr>)}
          </tbody></table></div>
          <Why value={{ density_kg_m3: plan.density, kg_per_m: plan.kg_per_m, kg_per_m_source: plan.kg_per_m_source, press_limits: press, rule: "Billet mass − butt mass = extruded mass; crops scrapped; whole pieces counted; push must fit the run-out." }} />
        </>}
      </article>)}
    </>}
  </Section>;
}

type Press = { machine_id: string; machine_name: string; settings: Record<string, number | null> | null };
export function PressBilletSettings() {
  const [rev, setRev] = useState(0);
  const read = useApRead<{ rows: Press[] }>("ap_billet_length", "presses", {}, [rev]);
  const summary = useApRead<{ jobs: number; with_standard: number; avg_chosen_recovery: number | null; avg_standard_recovery: number | null; improved: number }>("ap_billet_length", "summary", {}, [rev]);
  return <div className="space-y-5">
    {summary.data ? <Section title="Recovery from chosen billet lengths" description="Last 20 jobs with a recorded choice, against the press's standard billet length.">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat label="Jobs" value={summary.data.jobs} /><Stat label="Average chosen recovery" value={summary.data.avg_chosen_recovery == null ? "—" : `${summary.data.avg_chosen_recovery}%`} />
        <Stat label="Average at standard length" value={summary.data.avg_standard_recovery == null ? "—" : `${summary.data.avg_standard_recovery}%`} /><Stat label="Improved on standard" value={`${summary.data.improved} of ${summary.data.with_standard}`} /></div></Section> : null}
    <Section title="Press billet limits" description="Used for every billet-length recommendation. Missing limits mean no recommendation, never a guessed one.">
      {read.error ? <Failure text={read.error} /> : !read.data ? <Loading what="presses" /> : !read.data.rows.length ? <Empty>No active extrusion press.</Empty> : read.data.rows.map(p => <PressForm key={p.machine_id} press={p} onSaved={() => setRev(v => v + 1)} />)}
    </Section>
  </div>;
}

const FIELDS: [string, string, boolean][] = [["min_billet_mm", "Shortest billet (mm)", true], ["max_billet_mm", "Longest billet (mm)", true], ["standard_billet_mm", "Standard billet (mm)", false],
  ["container_diameter_mm", "Container bore (mm)", false], ["butt_mm", "Butt length (mm)", true], ["runout_m", "Run-out table (m)", true], ["front_crop_m", "Front crop (m)", false], ["back_crop_m", "Back crop (m)", false], ["step_mm", "Saw step (mm)", false]];
function PressForm({ press, onSaved }: { press: Press; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map(([k]) => [k, press.settings?.[k] == null ? "" : String(press.settings[k])])));
  const [note, setNote] = useState<Note>(null);
  return <article className="min-w-0 rounded-xl border p-3"><h3 className="font-bold">{press.machine_name}</h3>
    <div className="mt-2 grid gap-3 sm:grid-cols-3">{FIELDS.map(([k, label]) => <Field key={k} label={label}><NumberInput value={values[k]} onChange={v => setValues(x => ({ ...x, [k]: v }))} /></Field>)}</div>
    <Message value={note} />
    <Action disabled={FIELDS.some(([k, , req]) => req && !values[k].trim())} run={async () => {
      const payload: Record<string, unknown> = { machine_id: press.machine_id };
      for (const [k] of FIELDS) { const n = optional(values[k]); if (n !== undefined) payload[k] = n; }
      if (await write("ap_billet_length", "save_press", payload, setNote, "Billet limits saved.")) onSaved();
    }}>Save limits</Action>
  </article>;
}
