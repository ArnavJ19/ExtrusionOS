"use client";

// AP-023: a description field with a microphone. Speaking fills the text through the browser's speech recognition (Hindi
// or English); the person checks the text and saves as usual. Where the browser has no speech recognition the microphone
// is not shown and the field is an ordinary textarea. The app never records or uploads audio.
import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { VOICE_LANGUAGES, VOICE_NOTICE, appendDictation, parseVoiceLanguage, speechRecognitionCtor, type VoiceLanguage } from "@/lib/forms/voice-input";

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; abort: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null; onend: (() => void) | null;
};

const STORAGE_KEY = "extrusionos.voice-language";

type Props = {
  value: string; onChange: (value: string) => void; maxLength: number; id?: string; rows?: number; placeholder?: string; className?: string;
  required?: boolean; disabled?: boolean; ariaLabel?: string;
};

export function DictationTextarea({ value, onChange, maxLength, id, rows = 3, placeholder, className, required, disabled, ariaLabel }: Props) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [language, setLanguage] = useState<VoiceLanguage>("hi-IN");
  const [problem, setProblem] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const latest = useRef(value);
  // Keep the latest text for the recognition callback without writing the ref during render.
  useEffect(() => { latest.current = value; }, [value]);

  useEffect(() => {
    setSupported(Boolean(speechRecognitionCtor(window)));
    try { setLanguage(parseVoiceLanguage(window.localStorage.getItem(STORAGE_KEY))); } catch { /* the default language stands */ }
    return () => { try { recognition.current?.abort(); } catch { /* already stopped */ } };
  }, []);

  function stop() { try { recognition.current?.stop(); } catch { /* already stopped */ } setListening(false); }

  function start() {
    const Ctor = speechRecognitionCtor(window);
    if (!Ctor) return;
    setProblem(null);
    const r = new Ctor() as Recognition;
    r.lang = language; r.continuous = true; r.interimResults = false;
    r.onresult = event => {
      let spoken = "";
      for (let index = event.resultIndex; index < event.results.length; index++) if (event.results[index].isFinal) spoken += ` ${event.results[index][0].transcript}`;
      if (spoken.trim()) onChange(appendDictation(latest.current, spoken, maxLength));
    };
    r.onerror = event => {
      setProblem(event.error === "not-allowed" || event.error === "service-not-allowed" ? "Allow the microphone for this site to dictate." : event.error === "no-speech" ? "Nothing was heard. Tap the microphone and speak again." : "Dictation stopped. Type the text or try again.");
      setListening(false);
    };
    r.onend = () => setListening(false);
    recognition.current = r;
    try { r.start(); setListening(true); } catch { setProblem("Dictation could not start. Type the text instead."); }
  }

  function chooseLanguage(next: VoiceLanguage) {
    setLanguage(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* not remembered */ }
    if (listening) stop();
  }

  return <div className="min-w-0">
    <textarea id={id} aria-label={ariaLabel} rows={rows} maxLength={maxLength} placeholder={placeholder} required={required} disabled={disabled}
      className={className ?? "w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-base"} value={value} onChange={event => onChange(event.target.value)} />
    {supported && !disabled ? <div className="mt-1 flex flex-wrap items-center gap-2">
      <button type="button" onClick={listening ? stop : start} aria-pressed={listening} aria-label={listening ? "Stop dictation" : "Dictate the text"}
        className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-bold ${listening ? "border-rose-300 bg-rose-50 text-rose-800" : "border-neutral-300 bg-white text-neutral-900"}`}>
        {listening ? <Square className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}{listening ? "Stop" : "Speak"}
      </button>
      <div role="group" aria-label="Dictation language" className="inline-flex overflow-hidden rounded-xl border border-neutral-300">
        {VOICE_LANGUAGES.map(option => <button key={option.code} type="button" aria-pressed={language === option.code} onClick={() => chooseLanguage(option.code)}
          className={`min-h-11 px-3 text-sm font-semibold ${language === option.code ? "bg-neutral-950 text-white" : "bg-white text-neutral-800"}`}>{option.label}</button>)}
      </div>
      {listening ? <span role="status" className="text-sm font-semibold text-rose-700">Listening…</span> : null}
    </div> : null}
    {supported && !disabled ? <p className="mt-1 text-xs text-neutral-500">{VOICE_NOTICE}</p> : null}
    {problem ? <p role="alert" className="mt-1 text-sm text-rose-700">{problem}</p> : null}
  </div>;
}
