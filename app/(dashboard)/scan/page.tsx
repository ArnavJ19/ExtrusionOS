"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Camera, CameraOff, KeySquare, ShieldCheck, Trash2 } from "lucide-react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { Button } from "@/components/ui/button";
import { recordScanSessionAction, resolveScanAction, type ScanResolution, type ScanSessionResult } from "@/lib/actions/scan";
import { SCAN_TASKS, type ScanTask } from "@/lib/qr/scan-task";

type Mode = "lookup" | ScanTask;
type SessionItem = { code: string; result: Extract<ScanResolution, { ok: true }>; at: string };

const readable = (value: unknown) => value === null || value === undefined || value === "" ? "Not recorded" : String(value).replace(/_/g, " ");
const time = () => new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" });

// NOV-017: a scan identifies the record and leads into its permitted task. Every code is resolved on
// the server under the signed-in company; typing the code is always available.
export default function QRScannerPage() {
  const [mode, setMode] = useState<Mode>("lookup");
  const [camera, setCamera] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [result, setResult] = useState<Extract<ScanResolution, { ok: true }> | null>(null);
  const [session, setSession] = useState<SessionItem[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [outcome, setOutcome] = useState<ScanSessionResult | null>(null);
  const lastDecoded = useRef<{ code: string; at: number } | null>(null);
  const handler = useRef<(code: string) => void>(() => undefined);

  async function handle(raw: string) {
    const code = raw.trim();
    if (!code || processing) return;
    setProcessing(true); setMessage(null);
    try {
      const resolved = await resolveScanAction(code);
      if (!resolved.ok) { setMessage({ tone: "error", text: resolved.error }); return; }
      if (mode === "lookup") { setResult(resolved); setCamera(false); return; }
      if (!SCAN_TASKS[mode].accepts.includes(resolved.entityType)) { setMessage({ tone: "error", text: `${resolved.entityTypeLabel} ${resolved.label} is not part of a ${SCAN_TASKS[mode].label.toLowerCase()}.` }); return; }
      const duplicate = session.find(item => item.result.entityType === resolved.entityType && item.result.entityId === resolved.entityId);
      if (duplicate) { setMessage({ tone: "info", text: `${resolved.label} was already scanned at ${duplicate.at}. It is listed once.` }); return; }
      setSession(current => [{ code, result: resolved, at: time() }, ...current].slice(0, 100));
      setOutcome(null);
      setMessage({ tone: "info", text: `${resolved.label} added${resolved.warnings.length ? ` with ${resolved.warnings.length} warning(s)` : ""}. Scan the next label.` });
    } catch { setMessage({ tone: "error", text: "The scan could not be checked. Retry, or type the code." }); }
    finally { setProcessing(false); setManualCode(""); }
  }
  useEffect(() => {
    handler.current = (code: string) => {
      // The camera reports the same label many times a second; one read per label every 3 seconds.
      const now = Date.now();
      if (lastDecoded.current && lastDecoded.current.code === code && now - lastDecoded.current.at < 3000) return;
      lastDecoded.current = { code, at: now };
      void handle(code);
    };
  });

  useEffect(() => {
    if (!camera) return;
    let scanner: Html5QrcodeScanner | null = null;
    try {
      scanner = new Html5QrcodeScanner("qr-reader", { fps: 8, qrbox: { width: 240, height: 240 } }, false);
      scanner.render(decoded => handler.current(decoded), () => undefined);
    } catch { setCamera(false); setMessage({ tone: "error", text: "The camera could not start. Allow camera access, or type the code below." }); }
    return () => { scanner?.clear().catch(() => undefined); };
  }, [camera]);

  function changeMode(next: Mode) {
    if (session.length && next !== mode && !window.confirm("Switching task clears the unrecorded scans in this session. Continue?")) return;
    setMode(next); setSession([]); setResult(null); setOutcome(null); setMessage(null); setReviewing(false);
  }
  async function record() {
    if (mode === "lookup" || !session.length || processing) return;
    setProcessing(true);
    try {
      const response = await recordScanSessionAction({ task: mode, codes: session.map(item => item.code).reverse() });
      setOutcome(response);
      if (response.ok) { setSession([]); setReviewing(false); }
    } catch { setOutcome({ ok: false, error: "The result of recording is unknown. Check the scan history before recording again." }); }
    finally { setProcessing(false); }
  }

  return <div className="mx-auto max-w-xl space-y-4 pt-2">
    <div className="text-center"><h1 className="text-2xl font-black text-slate-900">Shop Floor Scanner</h1><p className="mt-1 text-sm text-slate-500">Scan a label to open its task, or check a set of labels in one session.</p></div>
    <label className="block space-y-1"><span className="form-label">What are you doing?</span>
      <select className="form-input" value={mode} onChange={event => changeMode(event.target.value as Mode)}><option value="lookup">Look up one record</option>
        {(Object.keys(SCAN_TASKS) as ScanTask[]).map(task => <option key={task} value={task}>{SCAN_TASKS[task].label} (several labels)</option>)}</select></label>
    {message ? <p role={message.tone === "error" ? "alert" : "status"} className={`rounded-xl border px-3 py-2 text-sm font-semibold ${message.tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-slate-200 bg-slate-50 text-slate-800"}`}>{message.text}</p> : null}

    {!result ? <>
      <div className="flex gap-2"><Button type="button" className="flex-1" variant={camera ? "secondary" : undefined} onClick={() => setCamera(value => !value)}>{camera ? <><CameraOff className="mr-2 h-4 w-4" />Stop camera</> : <><Camera className="mr-2 h-4 w-4" />Open camera</>}</Button></div>
      {camera ? <div className="overflow-hidden rounded-3xl border-4 border-slate-900 bg-white p-3"><div id="qr-reader" className="w-full overflow-hidden rounded-xl" /><p className="mt-2 text-xs text-slate-600">Poor light or a damaged label? Type the code below instead.</p></div> : null}
      <form onSubmit={event => { event.preventDefault(); void handle(manualCode); }} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
        <label className="block space-y-1"><span className="form-label flex items-center gap-2"><KeySquare className="h-4 w-4" />Type or paste the code</span>
          <input className="form-input text-center font-mono font-bold uppercase tracking-wider" value={manualCode} maxLength={200} autoComplete="off" autoCapitalize="characters" placeholder="Label code or record ID" onChange={event => setManualCode(event.target.value)} /></label>
        <Button type="submit" className="w-full" disabled={!manualCode.trim() || processing}>{processing ? "Checking..." : "Check code"}</Button>
      </form>
    </> : null}

    {result ? <section aria-label="Scanned record" className="space-y-4 overflow-hidden rounded-3xl border-2 border-emerald-600 bg-white">
      <div className="flex items-center gap-3 bg-emerald-600 p-4 text-white"><ShieldCheck className="h-6 w-6" /><div><p className="text-xs font-bold uppercase tracking-wider text-emerald-100">Verified {result.entityTypeLabel}</p><p className="text-lg font-black">{result.label}</p></div></div>
      <div className="space-y-4 px-4 pb-4">
        {result.warnings.length ? <ul aria-label="Warnings" className="space-y-2">{result.warnings.map(warning => <li key={warning.text} className={`rounded-xl border p-3 text-sm font-semibold ${warning.tone === "critical" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-950"}`}>{warning.text}</li>)}</ul> : null}
        <dl className="grid grid-cols-2 gap-3 text-sm">{Object.entries(result.details).map(([key, value]) => <div key={key} className="min-w-0"><dt className="text-xs font-bold uppercase text-slate-500">{key.replace(/_/g, " ")}</dt><dd className="break-words text-slate-900">{readable(value)}</dd></div>)}</dl>
        {result.actions.length ? <div className="space-y-2"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Next steps</p>{result.actions.map(action => <Link key={action.href + action.label} href={action.href} className="flex min-h-12 items-center justify-between rounded-xl bg-slate-900 px-4 text-sm font-bold text-white">{action.label}<span aria-hidden="true">→</span></Link>)}</div>
          : <p className="text-sm text-slate-600">No task for this record is available to your role. Search for it to see more.</p>}
        <p className="text-xs text-slate-500">A label shows identity, not physical custody. Each task screen checks the current status again before any change.</p>
        <Button type="button" variant="secondary" className="w-full" onClick={() => { setResult(null); setMessage(null); }}>Scan another label</Button>
      </div>
    </section> : null}

    {mode !== "lookup" ? <section aria-label={`${SCAN_TASKS[mode].label} session`} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="font-bold">{SCAN_TASKS[mode].label}: {session.length} label(s) scanned</h2>
      {session.length ? <ul className="space-y-2">{session.map(item => <li key={`${item.result.entityType}:${item.result.entityId}`} className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm">
        <div className="min-w-0"><p className="font-bold">{item.result.label} <span className="font-normal text-slate-500">· {item.result.entityTypeLabel} · {item.at}</span></p>
          {item.result.warnings.map(warning => <p key={warning.text} className={warning.tone === "critical" ? "text-red-800" : "text-amber-900"}>{warning.text}</p>)}</div>
        <button type="button" className="rounded-lg p-2 text-red-700 hover:bg-red-50" aria-label={`Remove ${item.result.label} from this session`} onClick={() => setSession(current => current.filter(entry => entry !== item))}><Trash2 className="h-4 w-4" /></button></li>)}</ul>
        : <p className="text-sm text-slate-600">Scan labels one after another. Each is checked when scanned and again when you record the session.</p>}
      {session.length && !reviewing ? <Button type="button" className="w-full" onClick={() => setReviewing(true)}>Review {session.length} scan(s)</Button> : null}
      {reviewing ? <div className="space-y-2 rounded-xl border border-slate-300 p-3"><p className="text-sm">Log {session.length} {SCAN_TASKS[mode].label.toLowerCase()} scan event(s) by you now? Logging records the scans only; it does not change stock, die or dispatch status. {mode === "loaded_for_dispatch" ? "Held or consumed bundles are refused." : "Warnings are kept with each scan."}</p>
        <div className="flex gap-2"><Button type="button" disabled={processing} onClick={() => void record()}>{processing ? "Logging..." : "Log these scans"}</Button><Button type="button" variant="secondary" disabled={processing} onClick={() => setReviewing(false)}>Back to scanning</Button></div></div> : null}
      {outcome ? outcome.ok ? <div role="status" className="space-y-1 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-950"><p className="font-bold">{outcome.recorded.length} scan event(s) logged.</p>
          {outcome.refused.map(item => <p key={item.code} className="text-red-800">Not logged: {item.reason}</p>)}</div>
        : <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{outcome.error}</p> : null}
    </section> : null}
  </div>;
}
