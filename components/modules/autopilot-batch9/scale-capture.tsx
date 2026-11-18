"use client";

// AP-010: reads the packing scale's indicator over Web Serial (USB or RS-232 adapter) on the packing computer. The live
// reading is shown; "Capture" is enabled only when the weight has settled, and fills the gross weight marked "from
// scale" with the raw indicator line kept as evidence. Typing in the field instead is always possible and is recorded as
// typed. The port choice and speed are remembered on this computer only.
import { useEffect, useRef, useState } from "react";
import { BAUD_RATES, DEFAULT_SCALE, StabilityTracker, parseIndicatorLine, splitStream, type StableState } from "@/lib/devices/scale-protocol";
import { floorText, type FloorLanguage } from "@/lib/i18n/floor";

export type ScaleCaptureValue = { kg: number; raw: string; readings: number; indicator: string };
type SerialPortLike = { open(options: { baudRate: number }): Promise<void>; close(): Promise<void>; readable: ReadableStream<Uint8Array> | null; getInfo?: () => { usbVendorId?: number; usbProductId?: number } };
type SerialLike = { requestPort(): Promise<SerialPortLike> };
const BAUD_KEY = "extrusionos:scale-baud:v1";

function serial(): SerialLike | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { serial?: SerialLike }).serial ?? null;
}

type Port = { port: SerialPortLike | null; reader: ReadableStreamDefaultReader<Uint8Array> | null };

/** Reads lines from an open port until it closes; reports each line and a silence of more than five seconds. */
async function readLines(chosen: SerialPortLike, refs: Port, onLine: (line: string) => void, onSilence: () => void) {
  const decoder = new TextDecoder();
  let buffer = ""; let lastData = Date.now();
  const watchdog = setInterval(() => { if (Date.now() - lastData > 5000) onSilence(); }, 2000);
  try {
    if (!chosen.readable) return;
    refs.reader = chosen.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await refs.reader.read();
        if (done) break;
        lastData = Date.now();
        const split = splitStream(buffer + decoder.decode(value, { stream: true }));
        buffer = split.rest;
        for (const line of split.lines) onLine(line);
      }
    } finally { refs.reader?.releaseLock(); refs.reader = null; }
  } catch {
    onSilence();
  } finally { clearInterval(watchdog); }
}

async function closePort(refs: Port) {
  try { await refs.reader?.cancel(); } catch { /* already closed */ }
  try { await refs.port?.close(); } catch { /* already closed */ }
  refs.port = null; refs.reader = null;
}

export function ScaleCapture({ lang = "en", onCapture, disabled = false }: { lang?: FloorLanguage; onCapture: (value: ScaleCaptureValue) => void; disabled?: boolean }) {
  const t = floorText(lang);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [baud, setBaud] = useState<number>(9600);
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<StableState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const refs = useRef<Port>({ port: null, reader: null });
  const tracker = useRef(new StabilityTracker(DEFAULT_SCALE));
  const lastLine = useRef<string>("");
  const indicator = useRef<string>("serial scale");

  useEffect(() => {
    setSupported(Boolean(serial()));
    try { const saved = Number(localStorage.getItem(BAUD_KEY)); if ((BAUD_RATES as readonly number[]).includes(saved)) setBaud(saved); } catch { /* optional */ }
    const held = refs.current;
    return () => { void closePort(held); };
  }, []);

  // Re-evaluate stability as time passes even when the indicator sends identical lines slowly.
  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => setState(tracker.current.state(Date.now())), 250);
    return () => clearInterval(timer);
  }, [connected]);

  async function connect() {
    const api = serial();
    if (!api) return;
    setMessage(null);
    try {
      const chosen = await api.requestPort();
      await chosen.open({ baudRate: baud });
      try { localStorage.setItem(BAUD_KEY, String(baud)); } catch { /* optional */ }
      const info = chosen.getInfo?.();
      indicator.current = info?.usbVendorId ? `usb ${info.usbVendorId.toString(16)}:${(info.usbProductId ?? 0).toString(16)} @${baud}` : `serial @${baud}`;
      refs.current.port = chosen; tracker.current.reset(); setConnected(true);
      void readLines(chosen, refs.current, line => {
        const reading = parseIndicatorLine(line);
        if (!reading) return;
        setMessage(null); lastLine.current = reading.raw;
        setState(tracker.current.push(reading, Date.now()));
      }, () => setMessage(t("sc.noData")));
    } catch {
      setMessage(t("sc.denied"));
    }
  }

  async function disconnect() {
    await closePort(refs.current);
    setConnected(false); setState(null);
  }

  if (supported === false) return <p className="rounded-xl bg-neutral-50 p-3 text-sm text-neutral-700">{t("sc.unsupported")}</p>;
  const reason = !state ? t("sc.waiting") : state.stable ? t("sc.stable") : state.reading?.overload ? t("sc.overload") : state.reading && state.reading.kg <= 0 ? t("sc.empty")
    : state.reading?.stable === false ? t("sc.motion") : state.reading ? t("sc.settling") : t("sc.waiting");
  return <section aria-label={t("sc.title")} className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h2 className="font-bold">{t("sc.title")}</h2><p className="text-xs text-neutral-600">{t("sc.help")}</p></div>
      {connected ? <button type="button" className="min-h-11 rounded-xl border border-neutral-300 px-3 text-sm font-bold" onClick={() => void disconnect()}>{t("sc.disconnect")}</button> : null}</div>
    {!connected ? <div className="flex flex-wrap items-end gap-2">
      <label className="text-sm font-semibold">{t("sc.baud")}<select className="mt-1 block min-h-11 rounded-xl border border-neutral-300 bg-white px-3" value={baud} onChange={e => setBaud(Number(e.target.value))}>{BAUD_RATES.map(b => <option key={b} value={b}>{b}</option>)}</select></label>
      <button type="button" disabled={disabled || supported !== true} className="min-h-11 rounded-xl bg-neutral-950 px-4 text-sm font-bold text-white disabled:opacity-50" onClick={() => void connect()}>{t("sc.connect")}</button>
    </div> : <div className="flex flex-wrap items-center justify-between gap-3">
      <div aria-live="polite"><p className="text-3xl font-black tabular-nums">{state?.reading && Number.isFinite(state.reading.kg) ? `${state.reading.kg.toFixed(3)} kg` : "— kg"}</p>
        <p className={`text-sm font-semibold ${state?.stable ? "text-emerald-700" : "text-amber-800"}`}>{reason}</p></div>
      <button type="button" disabled={disabled || !state?.stable || state.settledKg === null} className="min-h-14 rounded-2xl bg-emerald-600 px-5 text-lg font-black text-white disabled:opacity-50"
        onClick={() => { if (state?.settledKg != null) onCapture({ kg: state.settledKg, raw: lastLine.current.slice(0, 80), readings: state.count, indicator: indicator.current.slice(0, 60) }); }}>{t("sc.capture")}</button>
    </div>}
    <p className="text-xs text-neutral-500">{t("sc.manualNote")}</p>
    {message ? <p role="status" className="text-sm text-amber-800">{message}</p> : null}
  </section>;
}
