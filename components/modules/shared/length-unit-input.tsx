"use client";

import { useEffect, useRef, useState } from "react";
import { displayLength, lengthUnits, parseLengthEntry, type LengthUnit } from "@/lib/calculations/length-units";

const mmText = (metres: number) => `${(Math.round(metres * 1000 * 1000) / 1000).toLocaleString("en-IN", { maximumFractionDigits: 3 })} mm`;

/**
 * Cut length entry. AP-040: type what the customer said — "21ft", "6.4m", "6400", "12' 6\"" — and the millimetre value
 * shows beside the field before saving. A bare number follows the unit selector. The stored value stays in metres; the
 * text as entered is reported through onTextChange so the line keeps it for audit.
 */
export function LengthUnitInput({ metres, onChange, text: savedText, onTextChange }: { metres: number; onChange: (value: number) => void; text?: string | null; onTextChange?: (text: string | null) => void }) {
  const [unit, setUnit] = useState<LengthUnit>("m"), [text, setText] = useState(() => savedText || displayLength(metres, "m")), [error, setError] = useState(""), [note, setNote] = useState("");
  const emitted = useRef(metres);
  useEffect(() => {
    if (metres !== emitted.current) { emitted.current = metres; setText(displayLength(metres, unit)); setError(""); setNote(""); }
  }, [metres, unit]);
  return <div className="min-w-0 space-y-1.5"><label className="block space-y-1.5"><span className="form-label">Length {unit}</span><input className="form-input" type="text" inputMode="text" value={text} aria-invalid={Boolean(error)} onChange={event => {
    setText(event.target.value); const parsed = parseLengthEntry(event.target.value, unit);
    if (parsed.error !== undefined) { setError(parsed.error); setNote(""); emitted.current = 0; onChange(0); onTextChange?.(null); return; }
    setError(""); setNote(parsed.warning ?? `${parsed.read_as} = ${mmText(parsed.metres)}`); emitted.current = parsed.metres; onChange(parsed.metres); onTextChange?.(parsed.original);
  }} /></label><label className="flex items-center gap-2 text-xs text-slate-600"><span>Length unit</span><select aria-label="Length unit" className="min-w-0 rounded-lg border border-slate-200 bg-white p-1" value={unit} onChange={event => {
    const next = event.target.value as LengthUnit; setUnit(next); setText(displayLength(metres, next)); setNote(""); setError(metres > 0 ? "" : "Enter a valid cut length.");
  }}>{Object.entries(lengthUnits).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>{error ? <p role="alert" className="text-xs text-red-700">{error}</p> : <p className="text-xs text-slate-500" aria-live="polite">{note ? <span className="font-semibold text-slate-700">{note.replace(/\.$/, "")}. </span> : null}Saved as {displayLength(metres, "m")} m. That is {mmText(metres)}. Units such as 21ft, 6400mm or 12&apos; 6&quot; can be typed.</p>}</div>;
}
