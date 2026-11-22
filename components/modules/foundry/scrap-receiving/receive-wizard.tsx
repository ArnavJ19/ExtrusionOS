"use client";

// Guided scrap receipt for the foundry manager. Step 1 asks whether they are at the receiving site; leaving here records
// nothing. Once step 1 is confirmed the receipt exists and cannot be dropped: each "Leave" press is counted, the fifth
// asks for a reason and alerts the factory manager, and only the factory manager can let the receiver leave. Step 2 is
// the visual verification with the weighbridge weight and photos, step 3 the material details (no money). Completing it
// creates the scrap lot and tells accounts to add the bill.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ALLOY_OPTIONS, EXIT_ATTEMPT_LIMIT, PROCESSING_STEPS, QUALITY_ISSUES, READINESS, RECEIPT_QUALITIES, VISUAL_CHECKS, VISUAL_CHECK_KEYS,
  acceptedKg, exitAttemptState, indianMobile, netWeightKg, type ProcessingStep, type QualityIssue, type ReceiptDetail, type ScrapType, type VisualCheck
} from "@/lib/foundry/scrap-receiving";
import { Failure, Loading, Message, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../../order-to-cash/ui";
import { FileAttach, FileList, kgText, labelClass, type Note } from "./shared";

type OpenRequest = { id: string; request_number: string; scrap_type: string; alloy: string; quantity_kg: number; received_kg: number };

function Steps({ step }: { step: 1 | 2 | 3 }) {
  const names = ["Presence at site", "Visual verification", "Material details"];
  return <ol className="grid grid-cols-3 gap-2" aria-label="Receiving steps">
    {names.map((name, index) => <li key={name} aria-current={index + 1 === step ? "step" : undefined}
      className={`rounded-xl border px-3 py-2 text-xs font-bold ${index + 1 === step ? "border-neutral-950 bg-neutral-950 text-white" : index + 1 < step ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-neutral-200 bg-white text-neutral-500"}`}>
      <span className="block text-[11px] font-black uppercase tracking-wide">Step {index + 1}</span>{name}</li>)}
  </ol>;
}

export function ReceiveWizard({ companyId, initialReceiptId, initialRequestId }: { companyId: string; initialReceiptId: string | null; initialRequestId: string | null }) {
  const [receiptId, setReceiptId] = useState<string | null>(initialReceiptId);
  if (!receiptId) return <PresenceStep initialRequestId={initialRequestId} onStarted={setReceiptId} />;
  return <ReceiptInProgress companyId={companyId} receiptId={receiptId} />;
}

// ---------------------------------------------------------------- step 1
function PresenceStep({ initialRequestId, onStarted }: { initialRequestId: string | null; onStarted: (id: string) => void }) {
  const router = useRouter();
  const requests = useApRead<{ rows: OpenRequest[] }>("ap_scrap_receipt", "requests", { status: "open" }, []);
  const [requestId, setRequestId] = useState(initialRequestId ?? "");
  const [answer, setAnswer] = useState<"yes" | "no" | "proxy" | null>(null);
  const [proxy, setProxy] = useState({ name: "", phone: "", reason: "" });
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<Note>(null);
  const phoneOk = indianMobile(proxy.phone) !== null;
  async function start(present: boolean) {
    setBusy(true);
    const out = await apWrite<{ id: string }>("ap_scrap_receipt", "start", present
      ? { present: true, ...(requestId ? { request_id: requestId } : {}) }
      : { present: false, ...(requestId ? { request_id: requestId } : {}), proxy_name: proxy.name.trim(), proxy_phone: proxy.phone.trim(), proxy_reason: proxy.reason.trim() }, setMessage);
    setBusy(false);
    if (out) onStarted(out.id);
  }
  return <div className="space-y-4">
    <Steps step={1} />
    <Section title="Are you present at the receiving site?" description="Scrap is received only with someone at the weighbridge and unloading point. If you leave at this step nothing is recorded.">
      <label className={labelClass}>Receiving against a scrap request (optional)
        <select className={inputClass} value={requestId} onChange={(e) => setRequestId(e.target.value)}>
          <option value="">No request: unplanned delivery</option>
          {(requests.data?.rows ?? []).map((r) => <option key={r.id} value={r.id}>{r.request_number} · {r.scrap_type} · {r.alloy} · {kgText(r.quantity_kg)} (received {kgText(r.received_kg)})</option>)}
        </select></label>
      {requests.error ? <Failure text={requests.error} /> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={busy} onClick={() => { setAnswer("yes"); void start(true); }}>Yes, I am at the site</button>
        <button type="button" className={secondaryClass} disabled={busy} onClick={() => setAnswer("no")}>No, I am not at the site</button>
      </div>
      {answer === "no" ? <div role="alert" className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
        <p className="text-sm font-bold text-amber-900">You must be at the receiving site to receive scrap.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={secondaryClass} onClick={() => router.push("/foundry/scrap")}>Exit (nothing is recorded)</button>
          <button type="button" className={buttonClass} onClick={() => setAnswer("proxy")}>Someone else is receiving on my behalf</button>
        </div>
      </div> : null}
      {answer === "proxy" ? <div className="space-y-3 rounded-xl border bg-neutral-50 p-3">
        <p className="text-sm font-bold">Details of the person receiving the scrap (all required)</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={labelClass}>Name<input className={inputClass} value={proxy.name} maxLength={80} onChange={(e) => setProxy({ ...proxy, name: e.target.value })} /></label>
          <label className={labelClass}>Mobile number<input className={inputClass} inputMode="tel" value={proxy.phone} maxLength={16} placeholder="98220 12345" onChange={(e) => setProxy({ ...proxy, phone: e.target.value })} />
            {proxy.phone && !phoneOk ? <span className="text-xs font-semibold text-rose-700">Enter a 10-digit Indian mobile number.</span> : null}</label>
        </div>
        <label className={labelClass}>Why you are not at the site<textarea className={`${inputClass} min-h-16 py-2`} value={proxy.reason} maxLength={300} onChange={(e) => setProxy({ ...proxy, reason: e.target.value })} placeholder="At least 10 characters" /></label>
        <button type="button" className={buttonClass} disabled={busy || proxy.name.trim().length < 2 || !phoneOk || proxy.reason.trim().length < 10} onClick={() => start(false)}>Continue to visual verification</button>
      </div> : null}
      <Message value={message} />
    </Section>
  </div>;
}

// ---------------------------------------------------------------- steps 2 and 3
function ReceiptInProgress({ companyId, receiptId }: { companyId: string; receiptId: string }) {
  const receipt = useApRead<ReceiptDetail>("ap_scrap_receipt", "get", { id: receiptId }, []);
  const r = receipt.data;
  const inProgress = r ? r.status === "inspection" || r.status === "details" : false;
  useEffect(() => {
    if (!inProgress) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [inProgress]);
  if (receipt.loading && !r) return <Loading what="the receipt" />;
  if (receipt.error || !r) return <Failure text={receipt.error ?? "The receipt could not be loaded."} />;
  if (r.status === "completed") return <Section title={`${r.receipt_number} received`} description="Accounts have been told to add the vendor and the bill.">
    <p className="text-sm">{kgText(r.accepted_kg)} accepted{r.rejected_kg ? `, ${kgText(r.rejected_kg)} not of quality` : ""}.</p>
    <div className="flex flex-wrap gap-2">
      <Link className={`${buttonClass} inline-flex items-center`} href={`/foundry/scrap/receipts/${r.id}`}>Open the receipt</Link>
      <Link className={`${secondaryClass} inline-flex items-center`} href="/foundry/scrap/receive">Receive another load</Link>
    </div>
  </Section>;
  if (r.status === "exited") return <Section title={`${r.receipt_number} closed`} description="The factory manager allowed you to leave this receipt. No scrap was recorded.">
    <Link className="text-sm font-bold underline" href={`/foundry/scrap/receipts/${r.id}`}>Open the receipt</Link></Section>;
  if (!r.is_receiver) return <Failure text="This receipt is being received by someone else." />;
  return <div className="space-y-4">
    <Steps step={r.status === "inspection" ? 2 : 3} />
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2 text-sm">
      <span><b>{r.receipt_number}</b>{r.request ? ` · against ${r.request.request_number}` : ""}{r.receiver_present ? "" : ` · received by ${r.proxy_name} (${r.proxy_phone})`}</span>
    </div>
    <ExitControl receipt={r} onChange={receipt.reload} />
    {r.status === "inspection" ? <InspectionStep companyId={companyId} receipt={r} onDone={receipt.reload} /> : <DetailsStep receipt={r} onDone={receipt.reload} />}
  </div>;
}

function ExitControl({ receipt, onChange }: { receipt: ReceiptDetail; onChange: () => void }) {
  const pending = Boolean(receipt.exit_requested_at);
  const state = exitAttemptState(receipt.abort_attempts, pending);
  const [asking, setAsking] = useState(false); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState<Note>(null);
  async function attempt(withReason?: string) {
    setBusy(true);
    const out = await apWrite<{ attempts: number; remaining?: number; needs_reason?: boolean; escalated?: boolean; pending?: boolean }>("ap_scrap_receipt", "abort",
      { receipt_id: receipt.id, ...(withReason ? { reason: withReason } : {}) }, setMessage);
    setBusy(false);
    if (!out) return;
    if (out.needs_reason) { setAsking(true); setMessage({ tone: "error", text: "You cannot leave a receipt after confirming presence. Give the reason; the factory manager decides." }); }
    else if (out.escalated) { setAsking(false); setReason(""); setMessage({ tone: "error", text: "The factory manager has been alerted. Continue receiving until they decide." }); }
    else if (out.pending) setMessage({ tone: "error", text: "Your request to leave is with the factory manager. Continue receiving until they decide." });
    else setMessage({ tone: "error", text: `You cannot leave the receipt after step 1. Attempt ${out.attempts} of ${EXIT_ATTEMPT_LIMIT}; at ${EXIT_ATTEMPT_LIMIT} the factory manager is alerted.` });
    onChange();
  }
  return <div className="space-y-2">
    {pending ? <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <b>Waiting for the factory manager.</b> You asked to leave: “{receipt.exit_request_reason}”. Keep receiving; if they allow it, this receipt closes.
      <button type="button" className="ml-2 font-bold underline" onClick={onChange}>Check again</button></div> : null}
    {!pending && receipt.exit_decision === "declined" ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">The factory manager asked you to finish: “{receipt.exit_decision_reason}”</p> : null}
    {!pending ? <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="text-sm font-bold text-rose-700 underline disabled:opacity-50" disabled={busy}
        onClick={() => (state.kind === "needs_reason" ? setAsking(true) : attempt())}>Leave this receipt</button>
      {receipt.abort_attempts > 0 ? <span className="text-xs text-neutral-500">{receipt.abort_attempts} of {EXIT_ATTEMPT_LIMIT} exit attempts</span> : null}
    </div> : null}
    {asking && !pending ? <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3">
      <label className={labelClass}>Why do you need to leave this receipt? The factory manager will see this.
        <textarea className={`${inputClass} min-h-16 py-2`} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="At least 10 characters" /></label>
      <div className="flex gap-2"><button type="button" className={buttonClass} disabled={busy || reason.trim().length < 10} onClick={() => attempt(reason.trim())}>Send to the factory manager</button>
        <button type="button" className={secondaryClass} onClick={() => setAsking(false)}>Continue receiving</button></div>
    </div> : null}
    <Message value={message} />
  </div>;
}

function InspectionStep({ companyId, receipt, onDone }: { companyId: string; receipt: ReceiptDetail; onDone: () => void }) {
  const [form, setForm] = useState({ vehicle: receipt.vehicle_number ?? "", challan: receipt.challan_number ?? "", slip: receipt.weighbridge_reference ?? "",
    gross: receipt.gross_kg?.toString() ?? "", tare: receipt.tare_kg?.toString() ?? "", notes: receipt.inspection_notes ?? "" });
  const [checks, setChecks] = useState<Partial<Record<VisualCheck, boolean>>>(receipt.checklist ?? {});
  const [quality, setQuality] = useState<"ok" | "not_ok" | null>(receipt.quality_ok === null ? null : receipt.quality_ok ? "ok" : "not_ok");
  const [issues, setIssues] = useState<QualityIssue[]>(receipt.issues ?? []);
  const [scope, setScope] = useState<"all" | "partial" | null>(receipt.rejection_scope);
  const [rejected, setRejected] = useState(receipt.rejected_kg?.toString() ?? "");
  const [reason, setReason] = useState(receipt.rejection_reason ?? "");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<Note>(null);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: e.target.value }));
  const net = netWeightKg(form.gross === "" ? null : Number(form.gross), form.tare === "" ? null : Number(form.tare));
  const answered = VISUAL_CHECK_KEYS.every((key) => typeof checks[key] === "boolean");
  const failed = VISUAL_CHECK_KEYS.filter((key) => checks[key] === false);
  const photos = receipt.files.filter((f) => f.kind === "inspection_photo").length;
  const problemPhotos = receipt.files.filter((f) => f.kind === "rejection_photo").length;
  const accepted = net === null || quality === null ? null : acceptedKg(net, quality === "ok", scope, rejected === "" ? null : Number(rejected));
  const blocker = !form.vehicle.trim() ? "Enter the vehicle number." : !form.slip.trim() ? "Enter the weighbridge slip number." : net === null ? "Enter gross and tare from the weighbridge slip (gross more than tare)."
    : !photos ? "Take at least one photo of the scrap received." : !answered ? "Answer every visual check." : quality === null ? "Say whether the scrap is of the expected quality."
    : quality === "ok" && failed.length ? "A visual check failed: choose “The scrap is not of quality”."
    : quality === "not_ok" && !issues.length ? "Choose the quality problems." : quality === "not_ok" && !scope ? "Say whether all of it or a portion is not of quality."
    : quality === "not_ok" && scope === "partial" && accepted === null ? "Enter the weight of the portion not of quality (less than the net weight)."
    : quality === "not_ok" && reason.trim().length < 15 ? "Give the reason (at least 15 characters)." : quality === "not_ok" && !problemPhotos ? "Upload at least one photo showing the quality problem." : null;
  async function submit() {
    setBusy(true);
    const out = await apWrite("ap_scrap_receipt", "inspect", {
      receipt_id: receipt.id, vehicle_number: form.vehicle.trim(), ...(form.challan.trim() ? { challan_number: form.challan.trim() } : {}), weighbridge_reference: form.slip.trim(),
      gross_kg: Number(form.gross), tare_kg: Number(form.tare), quality_ok: quality === "ok", checklist: checks, ...(form.notes.trim().length >= 3 ? { notes: form.notes.trim() } : {}),
      ...(quality === "not_ok" ? { issues, rejection_scope: scope, ...(scope === "partial" ? { rejected_kg: Number(rejected) } : {}), rejection_reason: reason.trim() } : {})
    }, setMessage);
    setBusy(false);
    if (out) onDone();
  }
  return <div className="space-y-4">
    <Section title="Weighbridge weight" description="Enter the values printed on the weighbridge slip.">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className={labelClass}>Vehicle number<input className={inputClass} value={form.vehicle} onChange={set("vehicle")} maxLength={20} placeholder="MH12AB1234" /></label>
        <label className={labelClass}>Weighbridge slip no.<input className={inputClass} value={form.slip} onChange={set("slip")} maxLength={60} /></label>
        <label className={labelClass}>Supplier challan no. (optional)<input className={inputClass} value={form.challan} onChange={set("challan")} maxLength={40} /></label>
        <label className={labelClass}>Gross weight kg<input className={inputClass} inputMode="decimal" value={form.gross} onChange={set("gross")} /></label>
        <label className={labelClass}>Tare weight kg<input className={inputClass} inputMode="decimal" value={form.tare} onChange={set("tare")} /></label>
        <div className="rounded-xl bg-neutral-50 px-3 py-2"><span className={labelClass}>Net weight</span><b className="text-lg tabular-nums">{kgText(net)}</b></div>
      </div>
      <FileAttach companyId={companyId} parent={receipt.id} parentKey="receipt_id" kind="weighbridge_slip" label="Photo of the weighbridge slip (optional)" onAdded={onDone} capture="environment" />
      <FileList files={receipt.files} kinds={["weighbridge_slip"]} />
    </Section>
    <Section title="Visual verification" description="Check the load as it is unloaded. Answer every check.">
      <FileAttach companyId={companyId} parent={receipt.id} parentKey="receipt_id" kind="inspection_photo" imagesOnly capture="environment" label="Take photos of the scrap received (at least one)" onAdded={onDone} />
      <FileList files={receipt.files} kinds={["inspection_photo"]} empty="No photo yet." />
      <ul className="divide-y rounded-xl border">{VISUAL_CHECK_KEYS.map((key) => <li key={key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <span className="text-sm">{VISUAL_CHECKS[key]}</span>
        <span className="flex gap-1" role="group" aria-label={VISUAL_CHECKS[key]}>
          {([true, false] as const).map((value) => <button key={String(value)} type="button" aria-pressed={checks[key] === value}
            className={`min-h-9 rounded-lg border px-3 text-xs font-bold ${checks[key] === value ? (value ? "border-emerald-600 bg-emerald-600 text-white" : "border-rose-600 bg-rose-600 text-white") : "bg-white"}`}
            onClick={() => setChecks((current) => ({ ...current, [key]: value }))}>{value ? "Yes" : "No"}</button>)}
        </span></li>)}</ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={quality === "ok"} className={quality === "ok" ? buttonClass : secondaryClass} onClick={() => setQuality("ok")}>The scrap is of the expected quality</button>
        <button type="button" aria-pressed={quality === "not_ok"} className={quality === "not_ok" ? "min-h-11 rounded-xl bg-rose-700 px-4 text-sm font-bold text-white" : secondaryClass} onClick={() => setQuality("not_ok")}>The scrap is not of quality</button>
      </div>
      {quality === "not_ok" ? <div className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
        <fieldset><legend className={labelClass}>What is wrong</legend>
          <div className="mt-1 grid gap-1 sm:grid-cols-2">{(Object.keys(QUALITY_ISSUES) as QualityIssue[]).map((key) => <label key={key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={issues.includes(key)} onChange={(e) => setIssues((current) => (e.target.checked ? [...current, key] : current.filter((x) => x !== key)))} />{QUALITY_ISSUES[key]}</label>)}</div></fieldset>
        <fieldset><legend className={labelClass}>How much of the load</legend>
          <div className="mt-1 flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="scope" checked={scope === "all"} onChange={() => setScope("all")} />All of the scrap</label>
            <label className="flex items-center gap-2"><input type="radio" name="scope" checked={scope === "partial"} onChange={() => setScope("partial")} />Only a portion</label>
          </div></fieldset>
        {scope === "partial" ? <label className={labelClass}>Weight of the portion not of quality, kg<input className={inputClass} inputMode="decimal" value={rejected} onChange={(e) => setRejected(e.target.value)} /></label> : null}
        <label className={labelClass}>Reason the scrap is not of quality<textarea className={`${inputClass} min-h-20 py-2`} value={reason} maxLength={600} onChange={(e) => setReason(e.target.value)} placeholder="What you saw, where in the load, and how it was checked (at least 15 characters)" /></label>
        <FileAttach companyId={companyId} parent={receipt.id} parentKey="receipt_id" kind="rejection_photo" imagesOnly capture="environment" label="Photos of the quality problem (at least one)" onAdded={onDone} />
        <FileList files={receipt.files} kinds={["rejection_photo"]} empty="No problem photo yet." />
      </div> : null}
      <label className={labelClass}>Inspection notes (optional)<textarea className={`${inputClass} min-h-16 py-2`} value={form.notes} onChange={set("notes")} maxLength={600} /></label>
      {accepted !== null ? <p className="rounded-xl bg-neutral-50 px-3 py-2 text-sm">Net {kgText(net)} · taken into stock <b>{kgText(accepted)}</b>{quality === "not_ok" && net !== null ? ` · not of quality ${kgText(net - accepted)}` : ""}</p> : null}
      {blocker ? <p className="text-sm font-semibold text-amber-800">{blocker}</p> : null}
      <button type="button" className={buttonClass} disabled={busy || Boolean(blocker)} onClick={submit}>{busy ? "Saving…" : "Confirm verification and continue"}</button>
      <Message value={message} />
    </Section>
  </div>;
}

function DetailsStep({ receipt, onDone }: { receipt: ReceiptDetail; onDone: () => void }) {
  const types = useApRead<{ types: ScrapType[] }>("ap_scrap_receipt", "types", {}, []);
  const [typeId, setTypeId] = useState(receipt.scrap_type_id ?? "");
  const [newType, setNewType] = useState<string | null>(null);
  const [alloy, setAlloy] = useState(receipt.alloy ?? receipt.request?.alloy ?? "6063");
  const [readiness, setReadiness] = useState<keyof typeof READINESS | null>(receipt.readiness);
  const [steps, setSteps] = useState<ProcessingStep[]>(receipt.processing_steps ?? []);
  const [quality, setQuality] = useState<string>(receipt.scrap_quality ?? "");
  const [notes, setNotes] = useState(receipt.detail_notes ?? "");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<Note>(null);
  const accepted = Number(receipt.net_kg ?? 0) - Number(receipt.rejected_kg ?? 0);
  const qualityOptions = useMemo(() => Object.entries(RECEIPT_QUALITIES).filter(([key]) => readiness !== "ready_to_use" || !["contaminated", "segregation_required"].includes(key)), [readiness]);
  async function addType() {
    if (!newType || newType.trim().length < 3) return;
    const out = await apWrite<ScrapType>("ap_scrap_receipt", "add_type", { name: newType.trim() }, setMessage);
    if (out) { setTypeId(out.id); setNewType(null); setMessage({ tone: "ok", text: `Scrap type “${out.name}” added.` }); types.reload(); }
  }
  async function complete() {
    setBusy(true);
    const out = await apWrite("ap_scrap_receipt", "complete", { receipt_id: receipt.id, scrap_type_id: typeId, alloy: alloy.trim(), readiness,
      ...(readiness === "needs_processing" ? { processing_steps: steps } : {}), ...(quality ? { scrap_quality: quality } : {}), ...(notes.trim().length >= 3 ? { notes: notes.trim() } : {}) }, setMessage);
    setBusy(false);
    if (out) onDone();
  }
  const blocker = !typeId ? "Choose the scrap type." : alloy.trim().length < 2 ? "Choose the alloy." : !readiness ? "Say whether the scrap is ready to use or needs processing."
    : readiness === "needs_processing" && !steps.length ? "Choose the processing it needs." : null;
  return <Section title="What was received" description={`Net ${kgText(receipt.net_kg)}${receipt.rejected_kg ? ` · not of quality ${kgText(receipt.rejected_kg)}` : ""} · into stock ${kgText(accepted)}. No prices here: accounts add the bill.`}>
    <div className="grid gap-2 sm:grid-cols-2">
      <label className={labelClass}>Scrap type
        <select className={inputClass} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          <option value="">Choose…</option>
          {(types.data?.types ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select></label>
      <div className="flex items-end">{newType === null
        ? <button type="button" className={secondaryClass} onClick={() => setNewType("")}>New scrap type</button>
        : <div className="flex w-full gap-2"><input className={inputClass} aria-label="New scrap type name" value={newType} maxLength={80} onChange={(e) => setNewType(e.target.value)} placeholder="e.g. Imported extrusion (Taint/Tabor)" />
          <button type="button" className={buttonClass} disabled={newType.trim().length < 3} onClick={addType}>Add</button></div>}</div>
      <label className={labelClass}>Alloy
        <input className={inputClass} list="scrap-alloys" value={alloy} maxLength={20} onChange={(e) => setAlloy(e.target.value)} />
        <datalist id="scrap-alloys">{ALLOY_OPTIONS.map((a) => <option key={a} value={a} />)}</datalist></label>
      <label className={labelClass}>Quality grade (optional)
        <select className={inputClass} value={quality} onChange={(e) => setQuality(e.target.value)}>
          <option value="">{readiness === "needs_processing" ? "Segregation required (default)" : "Clean (default)"}</option>
          {qualityOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
    </div>
    {types.error ? <Failure text={types.error} /> : null}
    <fieldset><legend className={labelClass}>Is the scrap ready to use?</legend>
      <div className="mt-1 flex flex-wrap gap-3 text-sm">{(Object.keys(READINESS) as (keyof typeof READINESS)[]).map((key) => <label key={key} className="flex items-center gap-2">
        <input type="radio" name="readiness" checked={readiness === key} onChange={() => { setReadiness(key); setQuality(""); }} />{READINESS[key]}</label>)}</div></fieldset>
    {readiness === "needs_processing" ? <fieldset><legend className={labelClass}>Processing needed</legend>
      <div className="mt-1 grid gap-1 sm:grid-cols-2">{(Object.keys(PROCESSING_STEPS) as ProcessingStep[]).map((key) => <label key={key} className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={steps.includes(key)} onChange={(e) => setSteps((current) => (e.target.checked ? [...current, key] : current.filter((x) => x !== key)))} />{PROCESSING_STEPS[key]}</label>)}</div></fieldset> : null}
    <label className={labelClass}>Notes (optional)<textarea className={`${inputClass} min-h-16 py-2`} value={notes} maxLength={600} onChange={(e) => setNotes(e.target.value)} placeholder="Stacking bay, bundle count, anything accounts or the furnace team should know" /></label>
    {blocker ? <p className="text-sm font-semibold text-amber-800">{blocker}</p> : null}
    <button type="button" className={buttonClass} disabled={busy || Boolean(blocker)} onClick={complete}>{busy ? "Saving…" : "Complete the receipt"}</button>
    <Message value={message} />
  </Section>;
}
