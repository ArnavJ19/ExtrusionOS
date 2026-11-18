"use client";

// AP-009: on the job record, the values confirmed from photographed shift registers for this job.
import Link from "next/link";
import { fmtDay } from "@/lib/order-to-cash/commands";
import { Section, useApRead } from "../order-to-cash/ui";

/** Job record: what confirmed shift registers recorded for this job. */
export function JobRegisterRows({ jobId }: { jobId: string }) {
  const data = useApRead<{ rows: { capture_id: string; capture_number: string; shift_day: string; shift_name: string | null; pushes: number | null; backfilled: number; output_pcs: number | null; rejects: number | null; downtime_min: number | null; remarks: string | null }[] }>("ap_register", "job", { job_id: jobId }, []);
  if (data.loading || data.error || !data.data?.rows.length) return null;
  return <Section id="shift-registers" title="From shift registers" description="Values confirmed from photographed paper registers.">
    <ul className="text-sm">{data.data.rows.map(r => <li key={r.capture_id}><Link className="underline" href={`/production/registers/${r.capture_id}`}>{r.capture_number}</Link> · {fmtDay(r.shift_day)}{r.shift_name ? ` ${r.shift_name}` : ""} · pushes {r.pushes ?? "—"} ({r.backfilled} added) · output {r.output_pcs ?? "—"} pcs · rejects {r.rejects ?? "—"} · downtime {r.downtime_min ?? "—"} min{r.remarks ? ` · ${r.remarks}` : ""}</li>)}</ul>
  </Section>;
}
