"use client";

// AP-017: the packing station's label queue. Recording a bundle queues its label from the approved packing template
// (only that template's fields). With auto-print on, this page prints the next label as it arrives. A closed print
// dialog is not proof of printing, so the operator confirms each label unless the station is marked as printing
// silently (kiosk-printing mode). Reprints need a reason and are logged. The audit lists bundles of the week without a printed label.
import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Printer } from "lucide-react";
import { autopilotAction } from "@/lib/actions/autopilot";
import { fmtWhen } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";

type Note = { tone: "ok" | "error"; text: string } | null;
type Station = { id: string; name: string; location: string | null; auto_print: boolean; is_default: boolean; active: boolean; queued: number };
export type LabelJob = { id: string; bundle_id: string; bundle_number: string; order_number: string; customer: string; station: string | null; reason: string; note: string | null; status: string;
  template_revision: number | null; fields: Record<string, string>; missing: string[]; blocked_reason: string | null; queued_at: string; queued_by: string; printed_at: string | null; printed_by: string | null;
  seconds_to_print: number | null; dispatched: boolean };

const FIELD_LABELS: Record<string, string> = { bundle_number: "Bundle", order_number: "Order", customer: "Customer", customer_profile_ref: "Customer ref", profile_code: "Profile", finish: "Finish",
  cut_length_mm: "Cut length (mm)", pieces: "Pieces", net_kg: "Net kg", gross_kg: "Gross kg", drawing_revision: "Drawing rev", destination: "Destination", project: "Project", packed_on: "Packed on" };
/** Fields print in this order whatever order the stored payload has. */
const FIELD_ORDER = Object.keys(FIELD_LABELS);

export function BundleLabel({ job }: { job: Pick<LabelJob, "bundle_number" | "fields"> }) {
  return <div className="bundle-label w-[100mm] max-w-full space-y-2 rounded-lg border-2 border-neutral-950 bg-white p-3 text-neutral-950">
    <div className="flex items-start justify-between gap-2"><p className="break-all font-mono text-2xl font-black">{job.bundle_number}</p><QRCodeSVG value={job.bundle_number} size={96} level="M" /></div>
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">{Object.entries(job.fields).filter(([k]) => k !== "bundle_number").sort(([a], [b]) => FIELD_ORDER.indexOf(a) - FIELD_ORDER.indexOf(b)).map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-[10px] font-bold uppercase text-neutral-500">{FIELD_LABELS[k] ?? k}</dt><dd className="break-words font-bold">{v}</dd></div>)}</dl>
  </div>;
}

function ReprintForm({ job, onDone }: { job: LabelJob; onDone: (text: string) => void }) {
  const [open, setOpen] = useState(false); const [reason, setReason] = useState<"reprint" | "damaged" | "relabel">("damaged"); const [note, setNote] = useState(""); const [message, setMessage] = useState<Note>(null);
  if (job.dispatched) return null;
  if (!open) return <button type="button" className="underline" onClick={() => setOpen(true)}>Reprint</button>;
  return <span className="flex flex-wrap gap-2"><select aria-label="Reprint reason" className={`${inputClass} w-36`} value={reason} onChange={e => setReason(e.target.value as typeof reason)}><option value="damaged">Damaged tag</option><option value="reprint">Not printed</option><option value="relabel">Relabel</option></select>
    <input aria-label="Reprint note" className={`${inputClass} w-56`} value={note} onChange={e => setNote(e.target.value)} placeholder="What happened" />
    <button type="button" className={secondaryClass} onClick={async () => { if (await apWrite("ap_dispatch", "label_reprint", { bundle_id: job.bundle_id, reason, note: note.trim() }, setMessage)) { setOpen(false); onDone(`Reprint of ${job.bundle_number} queued.`); } }}>Queue reprint</button><Message value={message} /></span>;
}

export function LabelStationClient({ supervisor }: { supervisor: boolean }) {
  const [key, setKey] = useState(0);
  const stations = useApRead<Station[]>("ap_dispatch", "stations", {}, [key]);
  const [stationId, setStationId] = useState<string>("");
  const station = (stations.data ?? []).find(s => s.id === stationId) ?? (stations.data ?? []).find(s => s.is_default) ?? null;
  const [auto, setAuto] = useState<boolean | null>(null);
  const autoOn = auto ?? station?.auto_print ?? false;
  const [queue, setQueue] = useState<{ rows: LabelJob[]; total_count: number } | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [printing, setPrinting] = useState<LabelJob | null>(null);
  const [message, setMessage] = useState<Note>(null);
  const [bPage, setBPage] = useState(1); const [pPage, setPPage] = useState(1); const [aPage, setAPage] = useState(1);
  const blocked = useApRead<{ rows: LabelJob[]; total_count: number }>("ap_dispatch", "label_queue", { status: "blocked", page: bPage, ...(station ? { station_id: station.id } : {}) }, [key, station?.id]);
  const printed = useApRead<{ rows: LabelJob[]; total_count: number }>("ap_dispatch", "label_queue", { status: "printed", page: pPage, ...(station ? { station_id: station.id } : {}) }, [key, station?.id]);
  const audit = useApRead<{ rows: Array<{ bundle_id: string; bundle_number: string; order_number: string; recorded_at: string; job_status: string | null; blocked_reason: string | null }>; total_count: number;
    stats: { bundles: number; labelled: number; median_seconds: number | null; p90_seconds: number | null; reprints: number } }>("ap_dispatch", "label_audit", { days: 7, page: aPage }, [key]);
  const busy = useRef(false);
  // A closed print dialog is not proof of a printed label (Cancel also fires afterprint). Only a browser the operator
  // marked as printing silently (kiosk-printing mode) confirms on its own; otherwise the operator confirms each label.
  const [silent, setSilent] = useState(false);
  useEffect(() => { try { setSilent(window.localStorage.getItem("ap4-label-silent-print") === "1"); } catch { /* no storage: ask every time */ } }, []);
  const silentRef = useRef(false);
  useEffect(() => { silentRef.current = silent; }, [silent]);
  const [awaiting, setAwaiting] = useState<LabelJob | null>(null);

  const loadQueue = useCallback(async () => {
    const r = await autopilotAction("ap_dispatch", "label_queue", { status: "queued", ...(station ? { station_id: station.id } : {}) });
    if (!r.success) { setQueueError(r.error); return; }
    setQueueError(null); setQueue(r.data as { rows: LabelJob[]; total_count: number });
  }, [station]);
  useEffect(() => { void loadQueue(); const t = setInterval(() => { void loadQueue(); }, 4000); return () => clearInterval(t); }, [loadQueue]);

  const confirmPrinted = useCallback(async (job: LabelJob) => {
    const r = await autopilotAction("ap_dispatch", "label_printed", { job_id: job.id });
    busy.current = false; setPrinting(null); setAwaiting(null);
    if (!r.success) { setMessage({ tone: "error", text: r.error }); return; }
    setMessage({ tone: "ok", text: `Label ${job.bundle_number} printed.` }); setKey(k => k + 1); void loadQueue();
  }, [loadQueue]);

  const print = useCallback((job: LabelJob) => {
    if (busy.current) return; busy.current = true; setPrinting(job);
    // Render first, then open the print dialog. When it closes, a silent-printing station confirms the label; any other
    // station asks the operator whether it came out (the queue waits until they answer).
    setTimeout(() => {
      const after = () => { window.removeEventListener("afterprint", after); if (silentRef.current) void confirmPrinted(job); else setAwaiting(job); };
      window.addEventListener("afterprint", after);
      try { window.print(); } catch { window.removeEventListener("afterprint", after); busy.current = false; setPrinting(null); }
    }, 150);
  }, [confirmPrinted]);

  /** The operator says the label did not come out: the job stays queued and auto-print pauses so the dialog does not reopen at once. */
  const notPrinted = useCallback((job: LabelJob) => {
    busy.current = false; setPrinting(null); setAwaiting(null); setAuto(false);
    setMessage({ tone: "error", text: `Label ${job.bundle_number} is still waiting to print. Auto-print is paused; print it again when the printer is ready.` });
  }, []);

  useEffect(() => { if (autoOn && queue?.rows.length && !busy.current) print(queue.rows[0]); }, [autoOn, queue, print]);

  const [newStation, setNewStation] = useState("");
  return <div className="space-y-4">
    <style>{`@media print { body * { visibility: hidden !important; } #label-print, #label-print * { visibility: visible !important; } #label-print { position: fixed; left: 0; top: 0; } @page { size: 100mm 150mm; margin: 4mm; } }`}</style>
    <div id="label-print" aria-hidden={!printing} className={printing ? "fixed -left-[9999px] top-0 print:left-0" : "hidden"}>{printing ? <BundleLabel job={printing} /> : null}</div>
    <Section title="Packing station" description="Labels arrive here as bundles are recorded. Keep this page open on the station that drives the label printer.">
      {stations.loading && !stations.data ? <Loading what="stations" /> : stations.error ? <Failure text={stations.error} /> : <div className="flex flex-wrap items-end gap-3">
        {stations.data?.length ? <label className="text-sm font-semibold">Station<select className={`${inputClass} mt-1 w-56`} value={station?.id ?? ""} onChange={e => { setStationId(e.target.value); setAuto(null); }}>
          {stations.data.map(s => <option key={s.id} value={s.id}>{s.name}{s.is_default ? " (default)" : ""}</option>)}</select></label> : <p className="text-sm text-neutral-600">No station yet; labels wait in the queue for all stations.</p>}
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={autoOn} onChange={e => setAuto(e.target.checked)} />Auto-print on this screen</label>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={silent} onChange={e => { setSilent(e.target.checked); try { window.localStorage.setItem("ap4-label-silent-print", e.target.checked ? "1" : "0"); } catch { /* not remembered */ } }} />This browser prints without a dialog (kiosk printing)</label>
        {supervisor ? <span className="flex gap-2"><input aria-label="New station name" className={`${inputClass} w-48`} value={newStation} onChange={e => setNewStation(e.target.value)} placeholder="New station name" />
          <button type="button" className={secondaryClass} onClick={async () => { if (await apWrite("ap_dispatch", "save_station", { name: newStation.trim(), auto_print: true, is_default: !(stations.data ?? []).length }, setMessage, "Station added.")) { setNewStation(""); setKey(k => k + 1); } }}>Add station</button></span> : null}
      </div>}
      <p className="text-xs text-neutral-600">For printing without a dialog, run the station browser in kiosk-printing mode with the label printer as default (Chrome: --kiosk --kiosk-printing) and tick the box above. Otherwise you confirm each label after the print dialog closes.</p>
      {awaiting ? <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">
        <span className="font-semibold">Did label <b className="font-mono">{awaiting.bundle_number}</b> come out of the printer?</span>
        <button type="button" className={buttonClass} onClick={() => { void confirmPrinted(awaiting); }}>Yes, it printed</button>
        <button type="button" className={secondaryClass} onClick={() => notPrinted(awaiting)}>No, not printed</button>
      </div> : null}
      <Message value={message} />
    </Section>
    <Section title={`To print${queue ? ` (${queue.total_count})` : ""}`}>
      {queueError ? <Failure text={queueError} /> : !queue ? <Loading what="the queue" /> : !queue.rows.length ? <Empty>No label waiting.</Empty> :
        <div className="grid gap-3 md:grid-cols-2">{queue.rows.map(job => <div key={job.id} className="space-y-2">
          <BundleLabel job={job} />
          <p className="text-xs text-neutral-600">{job.order_number} · {job.reason === "initial" ? "new bundle" : `${job.reason}: ${job.note}`} · queued {fmtWhen(job.queued_at)}{job.missing.length ? ` · not on record: ${job.missing.map(m => FIELD_LABELS[m] ?? m).join(", ")}` : ""}</p>
          <button type="button" className={`${buttonClass} inline-flex items-center gap-2`} disabled={Boolean(printing)} onClick={() => print(job)}><Printer className="h-4 w-4" aria-hidden="true" />Print</button>
        </div>)}</div>}
    </Section>
    <Section title="Blocked labels" description="These bundles have no approved label template. Approve one (company, customer, project or order) and check again.">
      {blocked.loading && !blocked.data ? <Loading what="blocked labels" /> : blocked.error ? <Failure text={blocked.error} /> : !blocked.data?.rows.length ? <Empty>None.</Empty> :
        <ul className="space-y-2 text-sm">{blocked.data.rows.map(job => <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 p-2">
          <span><b className="font-mono">{job.bundle_number}</b> · {job.order_number} · {job.blocked_reason}</span>
          <button type="button" className={secondaryClass} onClick={async () => { const r = await apWrite<LabelJob>("ap_dispatch", "label_retry", { job_id: job.id }, setMessage); if (r) { setMessage({ tone: r.status === "queued" ? "ok" : "error", text: r.status === "queued" ? `${r.bundle_number} is ready to print.` : r.blocked_reason ?? "Still blocked." }); setKey(k => k + 1); void loadQueue(); } }}>Check again</button></li>)}</ul>}
      {blocked.data ? <Pager page={bPage} total={blocked.data.total_count} onPage={setBPage} /> : null}
    </Section>
    <Section title="Printed">
      {printed.loading && !printed.data ? <Loading what="printed labels" /> : printed.error ? <Failure text={printed.error} /> : !printed.data?.rows.length ? <Empty>Nothing printed yet.</Empty> :
        <ul className="space-y-1 text-sm">{printed.data.rows.map(job => <li key={job.id} className="flex flex-wrap items-center justify-between gap-2">
          <span><b className="font-mono">{job.bundle_number}</b> · {job.reason === "initial" ? "first label" : job.reason} · {fmtWhen(job.printed_at)} by {job.printed_by}{job.seconds_to_print !== null ? ` · ${job.seconds_to_print} s after recording` : ""}</span>
          <ReprintForm job={job} onDone={text => { setMessage({ tone: "ok", text }); void loadQueue(); }} /></li>)}</ul>}
      {printed.data ? <Pager page={pPage} total={printed.data.total_count} onPage={setPPage} /> : null}
    </Section>
    <Section title="Weekly label audit" description={audit.data ? `${audit.data.stats.labelled} of ${audit.data.stats.bundles} bundles recorded in 7 days have a label · median ${audit.data.stats.median_seconds ?? "—"} s, 90% within ${audit.data.stats.p90_seconds ?? "—"} s · ${audit.data.stats.reprints} reprint(s)` : undefined}>
      {audit.loading && !audit.data ? <Loading what="the audit" /> : audit.error ? <Failure text={audit.error} /> : !audit.data?.rows.length ? <Empty>Every bundle of the week has a printed label.</Empty> :
        <ul className="space-y-1 text-sm">{audit.data.rows.map(r => <li key={r.bundle_id}><b className="font-mono">{r.bundle_number}</b> · {r.order_number} · recorded {fmtWhen(r.recorded_at)} · <Pill value={r.job_status === "blocked" ? "blocked" : "held"} label={r.job_status ?? "not queued"} />{r.blocked_reason ? ` ${r.blocked_reason}` : ""}</li>)}</ul>}
      {audit.data ? <Pager page={aPage} total={audit.data.total_count} onPage={setAPage} /> : null}
    </Section>
  </div>;
}
