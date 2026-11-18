"use client";

// FS-36: the production-office wall. Large type for a TV; refreshes itself when pushes, jobs, plan slots or
// breakdowns change. Stoppages are shown in red.
import { useState } from "react";
import { kgText } from "@/lib/intelligence/format";
import { Failure, Loading, useFsRead } from "./shared";
import { LiveRefresh } from "./live";

type Press = { machine_id: string; press: string; code: string | null; job: { id: string; job_number: string | null; profile_code: string | null; die_number: string | null; planned_kg: number | null } | null;
  shift: string | null; target_kg: number | null; output_kg: number | null; pushes: number | null; last_push_at: string | null; target_kg_per_hour: number | null; output_kg_per_hour: number | null;
  next: { job_number: string | null; die_number: string | null; starts_at: string } | null; stoppage: { since: string; issue: string | null } | null };

export function WallClient() {
  const [key, setKey] = useState(0);
  const d = useFsRead<{ as_of: string; presses: Press[]; basis: string }>("fs_wall", "board", {}, [key]);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <LiveRefresh name="wall" tables={["production_push_events", "production_jobs", "production_plan_slots", "breakdown_logs"]} onChange={() => setKey(k => k + 1)} />
      {d.data ? <p className="text-xs text-neutral-500">{d.data.basis}</p> : null}
    </div>
    {d.loading && !d.data ? <Loading what="the presses" /> : d.error ? <Failure text={d.error} /> : d.data ? d.data.presses.length ? <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {d.data.presses.map(p => { const behind = p.target_kg_per_hour !== null && p.output_kg_per_hour !== null && p.output_kg_per_hour < p.target_kg_per_hour * 0.9;
        return <article key={p.machine_id} className={`min-w-0 rounded-3xl border-2 p-5 ${p.stoppage ? "border-rose-600 bg-rose-50" : "border-neutral-200 bg-white"}`}>
          <h2 className="text-3xl font-black">{p.press}</h2>
          {p.stoppage ? <p className="mt-2 text-2xl font-black text-rose-700">STOPPED since {new Date(p.stoppage.since).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}{p.stoppage.issue ? ` — ${p.stoppage.issue}` : ""}</p> : null}
          <p className="mt-2 text-xl">{p.job ? <><b>{p.job.job_number ?? "Job"}</b> · {p.job.profile_code ?? "—"} · die {p.job.die_number ?? "—"}</> : <span className="text-neutral-500">No job running</span>}</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div><p className="text-sm font-bold uppercase text-neutral-500">Now kg/h</p><p className={`text-4xl font-black tabular-nums ${behind ? "text-rose-700" : ""}`}>{p.output_kg_per_hour ?? "—"}</p></div>
            <div><p className="text-sm font-bold uppercase text-neutral-500">Target kg/h</p><p className="text-4xl font-black tabular-nums">{p.target_kg_per_hour ?? "—"}</p></div>
          </div>
          <p className="mt-2 text-base text-neutral-700">{p.shift ? `Shift ${p.shift}: ${kgText(p.output_kg)} of ${p.target_kg === null ? "no plan" : kgText(p.target_kg)} · ${p.pushes ?? 0} pushes` : "No shift running"}</p>
          <p className="mt-1 text-base">Next die: <b>{p.next?.die_number ?? "—"}</b>{p.next ? ` (${p.next.job_number ?? "job"} at ${new Date(p.next.starts_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })})` : ""}</p>
        </article>; })}
    </div> : <p className="text-lg">No active extrusion press is recorded.</p> : null}
  </div>;
}
