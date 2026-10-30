"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  createFactoryMaintenanceBlockAction,
  getFactoryDeliveryProposalAction,
  getFactoryPlanningSnapshotAction,
  moveFactoryProductionJobAction,
  saveFactoryFinishingLeadTimeAction,
  saveFactoryShiftCapacityAction
} from "@/lib/actions/factory-planning";
import { inspectProposedScheduleMove, type DeliveryProposal, type FactoryPlanningSnapshot } from "@/lib/workflow/factory-planning";
import { istLocalToIso } from "@/lib/workflow/shift-handover";
import { formatBusinessDateTime } from "@/lib/utils/business-date";
import { formatWeight } from "@/lib/utils/format";

type MoveInput = {
  production_job_id: string;
  slot_id: string | null;
  machine_id: string;
  planned_start_at: string;
  planned_end_at: string;
  shift: string;
  capacity_kg: number;
};

function localDateTime(day: string, time: string) {
  return `${day}T${time}`;
}

function machineLabel(snapshot: FactoryPlanningSnapshot, id: string) {
  return snapshot.machines.find(machine => machine.id === id)?.machine_name ?? "Press";
}

function materialReadiness(job: FactoryPlanningSnapshot["jobs"][number]) {
  const billets = job.billets_short > 0 ? `${job.billets_short} billets short` : job.billet_allocation_status.replaceAll("_", " ");
  return `Billets ${billets} · die ${job.die_status?.replaceAll("_", " ") ?? "missing"}`;
}

export function FactoryPlanning({ initialSnapshot, initialError, canMove, canConfigure, orders }: {
  initialSnapshot: FactoryPlanningSnapshot | null;
  initialError: string | null;
  canMove: boolean;
  canConfigure: boolean;
  orders: DeliveryForecastOrder[];
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [error, setError] = useState(initialError);
  const [pending, startTransition] = useTransition();
  const [jobId, setJobId] = useState(initialSnapshot?.jobs[0]?.id ?? "");
  const [machineId, setMachineId] = useState(initialSnapshot?.machines[0]?.id ?? "");
  const [start, setStart] = useState(() => initialSnapshot ? localDateTime(initialSnapshot.today, "09:00") : "");
  const [end, setEnd] = useState(() => initialSnapshot ? localDateTime(initialSnapshot.today, "10:00") : "");
  const [shift, setShift] = useState("");
  const [capacity, setCapacity] = useState("");
  const [reviewed, setReviewed] = useState<MoveInput | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [weekday, setWeekday] = useState("1");
  const [shiftName, setShiftName] = useState("Day");
  const [shiftStart, setShiftStart] = useState("08:00");
  const [shiftEnd, setShiftEnd] = useState("20:00");
  const [shiftCapacity, setShiftCapacity] = useState("");
  const [maintenanceMachine, setMaintenanceMachine] = useState(initialSnapshot?.machines[0]?.id ?? "");
  const [maintenanceStart, setMaintenanceStart] = useState(() => initialSnapshot ? localDateTime(initialSnapshot.today, "20:00") : "");
  const [maintenanceEnd, setMaintenanceEnd] = useState(() => initialSnapshot ? localDateTime(initialSnapshot.today, "22:00") : "");
  const [maintenanceReason, setMaintenanceReason] = useState("");
  const [finishingType, setFinishingType] = useState("powder coating");
  const [finishingDays, setFinishingDays] = useState("3");

  async function refresh() {
    const result = await getFactoryPlanningSnapshotAction();
    if (result.success) {
      setSnapshot(result.data);
      setError(null);
    } else setError(result.error);
  }

  function propose(input: MoveInput) {
    if (!snapshot) return;
    const plannedStart = istLocalToIso(input.planned_start_at);
    const plannedEnd = istLocalToIso(input.planned_end_at);
    if (!plannedStart || !plannedEnd) {
      setConflicts(["Enter valid start and end times in IST."]);
      setReviewed(null);
      return;
    }
    const issues = inspectProposedScheduleMove(snapshot, {
      ...input,
      planned_start_at: plannedStart,
      planned_end_at: plannedEnd
    });
    setConflicts(issues.map(issue => issue.message));
    setReviewed(issues.length ? null : input);
  }

  function submitMove() {
    if (!snapshot || !reviewed) return;
    const activeSlot = snapshot.slots.find(slot => slot.production_job_id === reviewed.production_job_id && ["scheduled", "released"].includes(slot.status));
    const job = snapshot.jobs.find(row => row.id === reviewed.production_job_id);
    if (!job) return setError("Refresh the schedule; the selected job is no longer available.");
    if (activeSlot?.status === "released") return setError("Released slots are locked and cannot be moved.");
    const plannedStart = istLocalToIso(reviewed.planned_start_at);
    const plannedEnd = istLocalToIso(reviewed.planned_end_at);
    if (!plannedStart || !plannedEnd) return setError("Refresh the schedule and enter valid start and end times in IST.");
    startTransition(async () => {
      setError(null);
      const result = await moveFactoryProductionJobAction({
        request_id: crypto.randomUUID(), production_job_id: reviewed.production_job_id, slot_id: activeSlot?.id ?? null,
        machine_id: reviewed.machine_id, planned_start_at: plannedStart,
        planned_end_at: plannedEnd, shift: reviewed.shift, capacity_kg: reviewed.capacity_kg,
        sequence_number: activeSlot?.sequence_number ?? 0, from_date: snapshot.from_date, through_date: snapshot.through_date, fingerprint: snapshot.fingerprint
      });
      if (!result.success) {
        setError(result.error);
        setReviewed(null);
        await refresh();
        return;
      }
      toast.success(result.replayed ? "The reviewed schedule move was already saved." : "Reviewed press move saved.");
      setReviewed(null);
      setConflicts([]);
      await refresh();
    });
  }

  function saveShift(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot) return;
    startTransition(async () => {
      const result = await saveFactoryShiftCapacityAction({
        machine_id: machineId, weekday: Number(weekday), shift_name: shiftName, starts_local: shiftStart,
        ends_local: shiftEnd, capacity_kg: Number(shiftCapacity)
      });
      if (!result.success) return setError(result.error);
      setSnapshot(result.data);
      setError(null);
      toast.success("Weekly press capacity saved.");
    });
  }

  function saveMaintenance(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!maintenanceStart || !maintenanceEnd) return setError("Enter both maintenance start and end times.");
    const startsAt = istLocalToIso(maintenanceStart);
    const endsAt = istLocalToIso(maintenanceEnd);
    if (!startsAt || !endsAt) return setError("Enter valid maintenance times in IST.");
    startTransition(async () => {
      const result = await createFactoryMaintenanceBlockAction({
        id: crypto.randomUUID(), machine_id: maintenanceMachine,
        starts_at: startsAt, ends_at: endsAt, reason: maintenanceReason
      });
      if (!result.success) return setError(result.error);
      setSnapshot(result.data);
      setMaintenanceReason("");
      setError(null);
      toast.success("Maintenance window added.");
    });
  }

  function saveFinishing(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveFactoryFinishingLeadTimeAction({ finishing_type: finishingType, lead_days: Number(finishingDays) });
      if (!result.success) return setError(result.error);
      setSnapshot(result.data);
      setError(null);
      toast.success("Finishing lead time saved.");
    });
  }

  if (!snapshot) return <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-900">{error ?? "Factory capacity could not be loaded."}</div>;

  const selectedJob = snapshot.jobs.find(job => job.id === jobId);
  const activeSlots = snapshot.slots.filter(slot => ["scheduled", "released"].includes(slot.status));
  const jobsById = new Map(snapshot.jobs.map(job => [job.id, job]));
  const configuredShifts = snapshot.shift_capacities.filter(row => row.machine_id === machineId);

  return (
    <div className="space-y-6">
      {error ? <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{error}</div> : null}
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Active presses</p><p className="mt-2 text-2xl font-black text-slate-950">{snapshot.machines.length}</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Open jobs</p><p className="mt-2 text-2xl font-black text-slate-950">{snapshot.jobs.length}</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Reviewed slots</p><p className="mt-2 text-2xl font-black text-slate-950">{activeSlots.length}</p></div>
      </section>

      <FactoryDeliveryForecast orders={orders} />

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="section-title">Press and shift timeline</h2><p className="mt-1 text-sm font-medium text-slate-500">Real production schedule slots for {snapshot.from_date} through {snapshot.through_date}. Dragging a job proposes a press; it never saves a move by itself.</p></div>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => void refresh()}>Refresh snapshot</Button>
        </div>
        <div className="mt-5 space-y-4">
          {snapshot.machines.map(machine => {
            const slots = activeSlots.filter(slot => slot.machine_id === machine.id).sort((a, b) => a.planned_start_at.localeCompare(b.planned_start_at));
            return <div key={machine.id} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-black text-slate-950">{machine.machine_name}</h3><span className="text-xs font-bold text-slate-500">{machine.status} · {configuredShifts.length} configured weekly shifts</span></div>
              <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(200px,1fr)_minmax(0,2fr)]">
                <button type="button" className="min-h-16 rounded-xl border border-dashed border-orange-300 bg-orange-50 p-3 text-left text-xs font-bold text-orange-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-700"
                  aria-label={`Propose a job on ${machine.machine_name}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData("text/factory-job"); if (id) { setJobId(id); setMachineId(machine.id); setReviewed(null); setConflicts([]); } }}>
                  Drop a job here to preselect this press. Choose an exact time and confirm the review below.
                </button>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {slots.map(slot => {
                    const job = jobsById.get(slot.production_job_id);
                    return <article key={slot.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-start justify-between gap-2"><strong className="text-sm text-slate-950">{job?.job_number ?? "Production job"}</strong><span className="rounded-full bg-white px-2 py-1 text-[10px] font-black uppercase text-slate-600">{slot.status}</span></div>
                      <p className="mt-1 text-xs font-semibold text-slate-600">{job?.order_number ?? "Order"} · {job?.profile_code ?? "Profile"}</p>
                      {job ? <p className={`mt-1 text-[11px] font-bold ${job.billets_short > 0 || !job.die_number ? "text-amber-800" : "text-emerald-800"}`}>Material readiness: {materialReadiness(job)}</p> : null}
                      <p className="mt-2 text-xs text-slate-600">{formatBusinessDateTime(slot.planned_start_at)} to {slot.planned_end_at ? formatBusinessDateTime(slot.planned_end_at) : "End not recorded"}</p>
                      <p className="mt-1 text-xs font-bold text-slate-700">{slot.shift ?? "Shift missing"} · {formatWeight(slot.capacity_kg ?? 0)}</p>
                      {slot.status === "released" ? <p className="mt-2 text-[11px] font-bold text-amber-800">Released slots are locked against moves.</p> : null}
                    </article>;
                  })}
                  {!slots.length ? <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">No scheduled slots on this press in the selected window.</p> : null}
                </div>
              </div>
            </div>;
          })}
        </div>
        <div className="mt-5 rounded-2xl bg-slate-50 p-4">
          <h3 className="font-black text-slate-950">Unscheduled work</h3>
          <p className="mt-1 text-xs text-slate-500">Use the controls as an accessible alternative to drag and drop.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {snapshot.jobs.filter(job => !snapshot.slots.some(slot => slot.production_job_id === job.id && ["scheduled", "released"].includes(slot.status))).map(job => <button key={job.id} type="button" draggable onDragStart={event => event.dataTransfer.setData("text/factory-job", job.id)} onClick={() => setJobId(job.id)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xs font-bold text-slate-800 hover:border-orange-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-700"><span>{job.job_number}</span><span className="ml-2 text-slate-500">{job.order_number} · {formatWeight(job.planned_quantity_kg)} · {materialReadiness(job)} · drag to a press</span></button>)}
            {!snapshot.jobs.some(job => !snapshot.slots.some(slot => slot.production_job_id === job.id && ["scheduled", "released"].includes(slot.status))) ? <p className="text-sm text-slate-500">Every open job already has an active press slot.</p> : null}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="section-title">Review a schedule move</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">Times use IST (Asia/Kolkata). The server checks the schedule fingerprint again and applies machine, job, shift, capacity, and maintenance guards atomically.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1"><span className="form-label">Production job</span><select className="form-input" value={jobId} onChange={event => { setJobId(event.target.value); setReviewed(null); }} disabled={!canMove || pending}><option value="">Choose a job</option>{snapshot.jobs.filter(job => job.status !== "in_progress").map(job => <option key={job.id} value={job.id}>{job.job_number} · {job.order_number} · {job.profile_code ?? "Profile"}</option>)}</select></label>
          <label className="space-y-1"><span className="form-label">Extrusion press</span><select className="form-input" value={machineId} onChange={event => { setMachineId(event.target.value); setReviewed(null); }} disabled={!canMove || pending}><option value="">Choose a press</option>{snapshot.machines.map(machine => <option key={machine.id} value={machine.id}>{machine.machine_name}</option>)}</select></label>
          <label className="space-y-1"><span className="form-label">Shift name</span><input className="form-input" value={shift} onChange={event => { setShift(event.target.value); setReviewed(null); }} list="factory-shifts" placeholder="Day / Night" disabled={!canMove || pending} /><datalist id="factory-shifts">{configuredShifts.map(row => <option key={row.id} value={row.shift_name} />)}</datalist></label>
          <label className="space-y-1"><span className="form-label">Slot kg capacity</span><input className="form-input" type="number" min="0.001" step="0.001" value={capacity || (selectedJob?.planned_quantity_kg ? String(selectedJob.planned_quantity_kg) : "")} onChange={event => { setCapacity(event.target.value); setReviewed(null); }} disabled={!canMove || pending} /></label>
          <label className="space-y-1"><span className="form-label">Start</span><input className="form-input" type="datetime-local" value={start} onChange={event => { setStart(event.target.value); setReviewed(null); }} disabled={!canMove || pending} /></label>
          <label className="space-y-1"><span className="form-label">End</span><input className="form-input" type="datetime-local" value={end} onChange={event => { setEnd(event.target.value); setReviewed(null); }} disabled={!canMove || pending} /></label>
          <div className="flex items-end gap-2"><Button type="button" variant="secondary" disabled={!canMove || pending || !jobId || !machineId || !start || !end || !shift} onClick={() => {
            const job = snapshot.jobs.find(row => row.id === jobId);
            const slot = snapshot.slots.find(row => row.production_job_id === jobId && ["scheduled", "released"].includes(row.status));
            if (!job || !Number(capacity || job.planned_quantity_kg)) return setConflicts(["Choose a job and a positive slot capacity."]);
            if (slot?.status === "released") return setConflicts(["Released slots are locked and cannot be moved."]);
            propose({ production_job_id: jobId, slot_id: slot?.id ?? null, machine_id: machineId, planned_start_at: start, planned_end_at: end, shift, capacity_kg: Number(capacity || job.planned_quantity_kg) });
          }}>Review proposal</Button></div>
        </div>
        {conflicts.length ? <div role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{conflicts.join(" ")}</div> : null}
        {reviewed ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-sm font-bold text-emerald-950">Review ready: {selectedJob?.job_number ?? "job"} on {machineLabel(snapshot, reviewed.machine_id)} · {reviewed.shift} · {formatWeight(reviewed.capacity_kg)} · {reviewed.planned_start_at} to {reviewed.planned_end_at}</p>
          <Button type="button" onClick={submitMove} disabled={!canMove || pending}>{pending ? "Confirming..." : "Confirm reviewed move"}</Button>
          {selectedJob && selectedJob.billets_short > 0 ? <p className="basis-full text-xs font-bold text-amber-900">Material readiness remains incomplete: {selectedJob.billets_short} billets short. Scheduling does not release the job or override the production start gate.</p> : null}
        </div> : null}
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <form onSubmit={saveShift} className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div><h2 className="section-title">Weekly press capacity</h2><p className="mt-1 text-xs text-slate-500">Capacity is kg per press and shift, repeated on that weekday.</p></div>
          <label className="block space-y-1"><span className="form-label">Press</span><select className="form-input" value={machineId} onChange={event => setMachineId(event.target.value)} disabled={!canConfigure || pending}>{snapshot.machines.map(machine => <option key={machine.id} value={machine.id}>{machine.machine_name}</option>)}</select></label>
          <label className="block space-y-1"><span className="form-label">Weekday</span><select className="form-input" value={weekday} onChange={event => setWeekday(event.target.value)} disabled={!canConfigure || pending}>{[[1,"Monday"],[2,"Tuesday"],[3,"Wednesday"],[4,"Thursday"],[5,"Friday"],[6,"Saturday"],[7,"Sunday"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="block space-y-1"><span className="form-label">Shift name</span><input className="form-input" value={shiftName} onChange={event => setShiftName(event.target.value)} maxLength={40} disabled={!canConfigure || pending} /></label>
          <div className="grid grid-cols-2 gap-2"><label className="space-y-1"><span className="form-label">Starts</span><input className="form-input" type="time" value={shiftStart} onChange={event => setShiftStart(event.target.value)} disabled={!canConfigure || pending} /></label><label className="space-y-1"><span className="form-label">Ends</span><input className="form-input" type="time" value={shiftEnd} onChange={event => setShiftEnd(event.target.value)} disabled={!canConfigure || pending} /></label></div>
          <label className="block space-y-1"><span className="form-label">Shift capacity (kg)</span><input className="form-input" type="number" min="0.001" step="0.001" value={shiftCapacity} onChange={event => setShiftCapacity(event.target.value)} disabled={!canConfigure || pending} /></label>
          <Button type="submit" disabled={!canConfigure || pending || !snapshot.machines.length}>Save shift capacity</Button>
          <ul className="space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600">{snapshot.shift_capacities.map(row => <li key={row.id}>{machineLabel(snapshot, row.machine_id)} · {row.shift_name} · weekday {row.weekday} · {row.starts_local}–{row.ends_local} · {formatWeight(row.capacity_kg)}</li>)}{!snapshot.shift_capacities.length ? <li>No shifts configured yet.</li> : null}</ul>
        </form>

        <form onSubmit={saveMaintenance} className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div><h2 className="section-title">Maintenance windows</h2><p className="mt-1 text-xs text-slate-500">Enter windows in IST (Asia/Kolkata). Active planned windows block overlapping slot writes.</p></div>
          <label className="block space-y-1"><span className="form-label">Press</span><select className="form-input" value={maintenanceMachine} onChange={event => setMaintenanceMachine(event.target.value)} disabled={!canConfigure || pending}>{snapshot.machines.map(machine => <option key={machine.id} value={machine.id}>{machine.machine_name}</option>)}</select></label>
          <label className="block space-y-1"><span className="form-label">Starts</span><input className="form-input" type="datetime-local" value={maintenanceStart} onChange={event => setMaintenanceStart(event.target.value)} disabled={!canConfigure || pending} /></label>
          <label className="block space-y-1"><span className="form-label">Ends</span><input className="form-input" type="datetime-local" value={maintenanceEnd} onChange={event => setMaintenanceEnd(event.target.value)} disabled={!canConfigure || pending} /></label>
          <label className="block space-y-1"><span className="form-label">Reason</span><input className="form-input" value={maintenanceReason} onChange={event => setMaintenanceReason(event.target.value)} minLength={3} maxLength={240} placeholder="Die change / planned service" disabled={!canConfigure || pending} /></label>
          <Button type="submit" disabled={!canConfigure || pending || !snapshot.machines.length}>Add maintenance window</Button>
          <ul className="space-y-2 border-t border-slate-100 pt-3 text-xs text-slate-600">{snapshot.maintenance_blocks.map(block => <li key={block.id}>{machineLabel(snapshot, block.machine_id)} · {formatBusinessDateTime(block.starts_at)} to {formatBusinessDateTime(block.ends_at)} · {block.reason}</li>)}{!snapshot.maintenance_blocks.length ? <li>No planned maintenance in this window.</li> : null}</ul>
        </form>

        <form onSubmit={saveFinishing} className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div><h2 className="section-title">Finishing lead times</h2><p className="mt-1 text-xs text-slate-500">Used in delivery forecasts and kept separate from customer promises.</p></div>
          <label className="block space-y-1"><span className="form-label">Finishing type</span><input className="form-input" value={finishingType} onChange={event => setFinishingType(event.target.value)} maxLength={60} disabled={!canConfigure || pending} /></label>
          <label className="block space-y-1"><span className="form-label">Lead time (calendar days)</span><input className="form-input" type="number" min="0" max="365" step="1" value={finishingDays} onChange={event => setFinishingDays(event.target.value)} disabled={!canConfigure || pending} /></label>
          <Button type="submit" disabled={!canConfigure || pending}>Save finishing lead time</Button>
          <ul className="space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600">{snapshot.finishing_lead_times.map(row => <li key={row.finishing_type}>{row.finishing_type} · {row.lead_days} calendar days</li>)}{!snapshot.finishing_lead_times.length ? <li>No finishing lead times configured yet.</li> : null}</ul>
        </form>
      </section>
    </div>
  );
}

export type DeliveryForecastOrder = { id: string; order_number: string; customer_name: string | null };

export function FactoryDeliveryForecast({ orders, loadError = null }: { orders: DeliveryForecastOrder[]; loadError?: string | null }) {
  const [selectedOrder, setSelectedOrder] = useState(orders[0]?.id ?? "");
  const [proposal, setProposal] = useState<DeliveryProposal | null>(null);
  const [error, setError] = useState<string | null>(loadError);
  const [pending, startTransition] = useTransition();

  function requestProposal() {
    setError(null);
    setProposal(null);
    startTransition(async () => {
      const result = await getFactoryDeliveryProposalAction(selectedOrder);
      if (!result.success) return setError(result.error);
      setProposal(result.data);
    });
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="max-w-3xl"><h2 className="section-title">Delivery forecast</h2><p className="mt-1 text-sm font-medium text-slate-500">This is an operational estimate from eligible measured stock, open production jobs, configured press capacity, and finishing lead times. It does not change or approve the customer promise date.</p></div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="min-w-72 flex-1 space-y-1"><span className="form-label">Open order</span><select className="form-input" value={selectedOrder} onChange={event => { setSelectedOrder(event.target.value); setProposal(null); }} disabled={!orders.length || pending}><option value="">Choose an order</option>{orders.map(order => <option key={order.id} value={order.id}>{order.order_number} · {order.customer_name ?? "Customer"}</option>)}</select></label>
        <Button type="button" disabled={!selectedOrder || pending} onClick={requestProposal}>{pending ? "Checking capacity..." : "Build forecast"}</Button>
      </div>
      {loadError ? <p role="alert" className="mt-3 text-sm font-semibold text-amber-800">{loadError}</p> : null}
      {!loadError && !orders.length ? <p className="mt-3 text-sm text-slate-500">No open orders are available for a delivery forecast.</p> : null}
      {error && !loadError ? <p role="alert" className="mt-3 text-sm font-semibold text-rose-800">{error}</p> : null}
      {proposal ? <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">Forecast for {proposal.orderNumber}</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{proposal.proposalDate ?? "Date withheld"}</p>
          <p className="mt-1 text-sm font-semibold text-slate-600">{proposal.capacityExplanation}</p>
          <p className="mt-3 text-xs font-bold text-slate-700">Eligible measured stock: {formatWeight(proposal.eligibleStockKg)} · Remaining dispatch: {formatWeight(proposal.remainingDispatchKg)} · Open production: {formatWeight(proposal.productionCapacityKg)}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><h3 className="font-black text-emerald-950">Assumptions</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-emerald-900">{proposal.assumptions.map(item => <li key={item}>{item}</li>)}</ul></div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><h3 className="font-black text-amber-950">Missing or incomplete inputs</h3>{proposal.missing.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-900">{proposal.missing.map(item => <li key={item}>{item}</li>)}</ul> : <p className="mt-2 text-xs text-amber-900">No missing capacity inputs were found for this forecast.</p>}</div>
        </div>
      </div> : null}
    </section>
  );
}
