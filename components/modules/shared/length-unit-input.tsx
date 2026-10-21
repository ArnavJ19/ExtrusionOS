"use client";

import { useEffect, useRef, useState } from "react";
import { displayLength, lengthUnits, parseLengthInput, type LengthUnit } from "@/lib/calculations/length-units";

export function LengthUnitInput({ metres, onChange }: { metres: number; onChange: (value: number) => void }) {
  const [unit, setUnit] = useState<LengthUnit>("m"), [text, setText] = useState(() => displayLength(metres, "m")), [error, setError] = useState("");
  const emitted = useRef(metres);
  useEffect(() => {
    if (metres !== emitted.current) { emitted.current = metres; setText(displayLength(metres, unit)); setError(""); }
  }, [metres, unit]);
  return <div className="min-w-0 space-y-1.5"><label className="block space-y-1.5"><span className="form-label">Length {unit}</span><input className="form-input" type="text" inputMode="decimal" value={text} aria-invalid={Boolean(error)} onChange={event => {
    setText(event.target.value); const parsed = parseLengthInput(event.target.value, unit); setError(parsed.error ?? ""); emitted.current = parsed.metres ?? 0; onChange(emitted.current);
  }} /></label><label className="flex items-center gap-2 text-xs text-slate-600"><span>Length unit</span><select aria-label="Length unit" className="min-w-0 rounded-lg border border-slate-200 bg-white p-1" value={unit} onChange={event => {
    const next = event.target.value as LengthUnit; setUnit(next); setText(displayLength(metres, next)); setError(metres > 0 ? "" : "Enter a valid cut length.");
  }}>{Object.entries(lengthUnits).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>{error ? <p role="alert" className="text-xs text-red-700">{error}</p> : <p className="text-xs text-slate-500">Saved as {displayLength(metres, "m")} m. Switching display units preserves the saved length.</p>}</div>;
}
