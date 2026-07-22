"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, LockKeyhole, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ReadinessBadge } from "@/components/modules/production-planning/readiness-badge";
import { assignProductionJobToPressAction, releaseProductionJobToPressAction } from "@/lib/actions/production";
import { formatDate, formatWeight } from "@/lib/utils/format";

type Press = {
  id: string;
  machine_name: string;
  machine_type: string;
  status: string;
  press_capacity_ton: number | null;
};

type Job = {
  id: string;
  job_number: string;
  status: string;
  planned_date: string | null;
  planned_quantity_kg: number | null;
  shift: string | null;
  machine_id: string | null;
  order?: { order_number?: string | null; priority?: string | null; customers?: { company_name?: string | null; customer_name?: string | null } | null } | null;
  profile?: { profile_code?: string | null; profile_name?: string | null } | null;
  die?: { die_number?: string | null } | null;
};

type Slot = {
  id: string;
  production_job_id: string;
  machine_id: string;
  planned_start_at: string;
  planned_end_at: string | null;
  shift: string | null;
  sequence_number: number | null;
  capacity_kg: number | null;
  status: string;
};

function machineName(presses: Press[], id: string | null | undefined) {
  return presses.find((press) => press.id === id)?.machine_name ?? "Unassigned";
}

export function PressScheduleGrid({ presses, jobs, slots, canUpdate }: { presses: Press[]; jobs: Job[]; slots: Slot[]; canUpdate: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedJobId, setSelectedJobId] = useState(jobs[0]?.id ?? "");
  const [selectedPressId, setSelectedPressId] = useState(presses[0]?.id ?? "");
  const [plannedStart, setPlannedStart] = useState(() => new Date().toISOString().slice(0, 16));
  const [plannedEnd, setPlannedEnd] = useState("");
  const [shift, setShift] = useState("");
  const [sequence, setSequence] = useState("0");

  const jobsById = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);
  const slotsByPress = useMemo(() => {
    const grouped = new Map<string, Slot[]>();
    for (const slot of slots) {
      const existing = grouped.get(slot.machine_id) ?? [];
      existing.push(slot);
      grouped.set(slot.machine_id, existing);
    }
    for (const group of grouped.values()) {
      group.sort((a, b) => new Date(a.planned_start_at).getTime() - new Date(b.planned_start_at).getTime() || Number(a.sequence_number ?? 0) - Number(b.sequence_number ?? 0));
    }
    return grouped;
  }, [slots]);

  async function scheduleJob() {
    if (!canUpdate) return toast.error("You do not have permission to schedule production.");
    if (!selectedJobId || !selectedPressId) return toast.error("Select a job and extrusion press.");
    startTransition(async () => {
      const result = await assignProductionJobToPressAction({
        production_job_id: selectedJobId,
        machine_id: selectedPressId,
        planned_start_at: new Date(plannedStart).toISOString(),
        planned_end_at: plannedEnd ? new Date(plannedEnd).toISOString() : null,
        shift: shift || null,
        sequence_number: Number(sequence || 0)
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Production job scheduled on press");
      router.refresh();
    });
  }

  async function releaseJob(jobId: string) {
    if (!canUpdate) return toast.error("You do not have permission to release production.");
    startTransition(async () => {
      const result = await releaseProductionJobToPressAction(jobId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Production job released to press");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <CalendarClock className="mt-1 h-5 w-5 text-orange" />
          <div>
            <h2 className="section-title">Assign Press Slot</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">Schedule a real production job on an available extrusion press. Release is blocked until this server action succeeds.</p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-6">
          <label className="block space-y-1.5 lg:col-span-2">
            <span className="form-label">Production job</span>
            <select className="form-input" value={selectedJobId} onChange={(event) => setSelectedJobId(event.target.value)} disabled={!canUpdate || isPending}>
              {jobs.map((job) => <option key={job.id} value={job.id}>{job.job_number} · {job.order?.order_number ?? "Order"} · {job.profile?.profile_code ?? "Profile"}</option>)}
            </select>
          </label>
          <label className="block space-y-1.5 lg:col-span-2">
            <span className="form-label">Extrusion press</span>
            <select className="form-input" value={selectedPressId} onChange={(event) => setSelectedPressId(event.target.value)} disabled={!canUpdate || isPending}>
              {presses.map((press) => <option key={press.id} value={press.id}>{press.machine_name} · {press.status}</option>)}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="form-label">Start</span>
            <input className="form-input" type="datetime-local" value={plannedStart} onChange={(event) => setPlannedStart(event.target.value)} disabled={!canUpdate || isPending} />
          </label>
          <label className="block space-y-1.5">
            <span className="form-label">End</span>
            <input className="form-input" type="datetime-local" value={plannedEnd} onChange={(event) => setPlannedEnd(event.target.value)} disabled={!canUpdate || isPending} />
          </label>
          <label className="block space-y-1.5">
            <span className="form-label">Shift</span>
            <input className="form-input" value={shift} onChange={(event) => setShift(event.target.value)} placeholder="Day / Night" disabled={!canUpdate || isPending} />
          </label>
          <label className="block space-y-1.5">
            <span className="form-label">Sequence</span>
            <input className="form-input" type="number" min="0" value={sequence} onChange={(event) => setSequence(event.target.value)} disabled={!canUpdate || isPending} />
          </label>
          <div className="flex items-end lg:col-span-2">
            <Button type="button" onClick={scheduleJob} disabled={!canUpdate || isPending || !jobs.length || !presses.length}>
              {isPending ? "Saving..." : "Schedule Job"}
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        {presses.map((press) => {
          const pressSlots = slotsByPress.get(press.id) ?? [];
          return (
            <div key={press.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-black text-slate-950">{press.machine_name}</h3>
                  <p className="mt-1 text-xs font-semibold text-slate-500">{press.press_capacity_ton ? `${press.press_capacity_ton} ton press` : "Capacity not captured"}</p>
                </div>
                <ReadinessBadge status={press.status} />
              </div>
              <div className="mt-4 space-y-3">
                {pressSlots.length ? pressSlots.map((slot) => {
                  const job = jobsById.get(slot.production_job_id);
                  return (
                    <div key={slot.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-black text-slate-950">{job?.job_number ?? "Production job"}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-500">{job?.order?.order_number ?? "Order"} · {job?.profile?.profile_code ?? "Profile"} · Die {job?.die?.die_number ?? "N/A"}</p>
                        </div>
                        <ReadinessBadge status={slot.status} />
                      </div>
                      <div className="mt-3 grid gap-1 text-xs font-semibold text-slate-600">
                        <span>Start: <b className="text-slate-950">{formatDate(slot.planned_start_at)}</b></span>
                        <span>Shift: <b className="text-slate-950">{slot.shift || job?.shift || "Not set"}</b></span>
                        <span>Capacity: <b className="text-slate-950">{formatWeight(slot.capacity_kg ?? job?.planned_quantity_kg ?? 0)}</b></span>
                      </div>
                      <div className="mt-3">
                        {slot.status === "released" ? (
                          <span className="inline-flex items-center gap-2 text-xs font-black text-emerald-700"><LockKeyhole className="h-3.5 w-3.5" /> Released</span>
                        ) : (
                          <Button type="button" variant="secondary" onClick={() => releaseJob(slot.production_job_id)} disabled={!canUpdate || isPending}>
                            <Send className="h-4 w-4" /> Release
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                }) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm font-semibold text-slate-500">No scheduled slots in the selected planning window.</div>
                )}
              </div>
            </div>
          );
        })}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="section-title">Unscheduled / Ready Jobs</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {jobs.filter((job) => !job.machine_id).map((job) => (
            <div key={job.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-black text-slate-950">{job.job_number}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">{job.order?.order_number || "Order"} · {job.profile?.profile_code || "Profile"} · {machineName(presses, job.machine_id)}</p>
                </div>
                <ReadinessBadge status={job.status} />
              </div>
              <p className="mt-3 text-xs font-semibold text-slate-600">Planned kg: <b className="text-slate-950">{formatWeight(job.planned_quantity_kg ?? 0)}</b></p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
