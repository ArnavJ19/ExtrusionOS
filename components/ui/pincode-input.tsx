"use client";

import { useEffect, useRef, useState } from "react";
import { canonicalStateName, loadPinTable, lookupPin, type PinLookup } from "@/lib/address/pin-code";

// AP-039: typing a six-digit PIN fills the state (and the district into a blank city when the India Post directory is
// bundled) from the offline table. Shared prefixes ask which state; a different state already entered is offered as a
// correction, never overwritten. City stays editable. No address leaves the browser.
export function PincodeInput({ id, value, onChange, state, onState, city, onCity, label = "PIN code", disabled, invalid, describedBy, className = "form-input" }: {
  id?: string; value: string; onChange: (value: string) => void; state: string; onState: (value: string) => void; city?: string; onCity?: (value: string) => void;
  label?: string; disabled?: boolean; invalid?: boolean; describedBy?: string; className?: string;
}) {
  const [result, setResult] = useState<PinLookup | null>(null);
  const [offline, setOffline] = useState(false);
  const stateRef = useRef(state);
  const cityRef = useRef(city);
  useEffect(() => { stateRef.current = state; cityRef.current = city; });
  const pin = value.replace(/\s+/g, "");

  useEffect(() => {
    let live = true;
    if (pin.length < 6) { setResult(null); return; }
    void loadPinTable().then(({ table, districts }) => {
      if (!live) return;
      if (!table) { setOffline(true); setResult(null); return; }
      const found = lookupPin(table, pin, districts);
      setResult(found);
      if (found.kind === "state" && !stateRef.current.trim()) onState(found.state);
      if ((found.kind === "state" || found.kind === "choose") && found.district && onCity && !(cityRef.current ?? "").trim()) onCity(found.district);
    });
    return () => { live = false; };
    // onState/onCity are setters from the parent form; the lookup reruns only when the PIN changes.
  }, [pin]);

  const current = canonicalStateName(state);
  return (
    <div className="space-y-1">
      <input id={id} className={className} inputMode="numeric" autoComplete="postal-code" maxLength={6} aria-label={id ? undefined : label} aria-invalid={invalid || undefined}
        aria-describedby={[describedBy, id ? `${id}-pin-note` : ""].filter(Boolean).join(" ") || undefined} disabled={disabled} value={value}
        onChange={(event) => onChange(event.target.value.replace(/[^\d]/g, "").slice(0, 6))} />
      <div id={id ? `${id}-pin-note` : undefined} className="text-xs text-neutral-600" aria-live="polite">
        {offline ? <p>The PIN table could not load. Enter the state yourself.</p>
          : !result ? null
          : result.kind === "state" ? (current && current !== result.state
            ? <p className="text-amber-800">PIN {result.pin} is in {result.state}, but the state says {state}. <button type="button" className="min-h-9 font-semibold underline" onClick={() => onState(result.state)}>Use {result.state}</button></p>
            : <p>State from PIN: <b>{result.state}</b>{result.district ? `, district ${result.district}` : ""}. City stays editable.</p>)
          : result.kind === "choose" ? <p>PIN {result.pin} is shared by {result.candidates.map(c => c.state).join(" and ")}. Choose:{" "}
            {result.candidates.map(c => <button key={c.code} type="button" aria-pressed={current === c.state} className="ml-1 min-h-9 rounded-full border border-neutral-300 px-2 font-semibold" onClick={() => onState(c.state)}>{c.state}</button>)}</p>
          : <p className={result.kind === "invalid" ? "text-red-800" : ""}>{result.reason}</p>}
      </div>
    </div>
  );
}
