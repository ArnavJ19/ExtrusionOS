"use client";

// AP-087: numeric input for the shop floor. Every numeric field opens the phone's number pad (inputmode); inside
// workstation mode a large on-screen keypad replaces the touch keyboard so gloved operators can enter numbers.
import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { Delete } from "lucide-react";
import { KEYPAD_ROWS, applyKeypadKey, cleanNumericInput, type KeypadKey } from "@/lib/forms/numeric-keypad";
import { cleanArithmeticInput, resolveNumericEntry } from "@/lib/forms/arithmetic";

const WorkstationModeContext = createContext(false);

export function WorkstationMode({ children }: { children: ReactNode }) {
  return <WorkstationModeContext.Provider value={true}>{children}</WorkstationModeContext.Provider>;
}

export function useWorkstationMode() { return useContext(WorkstationModeContext); }

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  decimal?: boolean;
  unit?: string;
  hint?: string;
  maxLength?: number;
  maxDecimals?: number;
  disabled?: boolean;
  id?: string;
  className?: string;
};

export function NumericField({ label, value, onChange, decimal = true, unit, hint, maxLength = 12, maxDecimals = 3, disabled, id, className }: Props) {
  const workstation = useWorkstationMode();
  const generated = useId();
  const inputId = id ?? `numeric-${generated}`;
  const [open, setOpen] = useState(false);
  // AP-088: "=12*6.4" or "250+180" typed on a keyboard becomes its result when focus leaves; the expression stays as a hint.
  const [calc, setCalc] = useState<{ hint: string | null; error: string | null }>({ hint: null, error: null });
  const press = (key: KeypadKey) => onChange(applyKeypadKey(value, key, { decimal, maxLength, maxDecimals }));
  return <div className={`min-w-0 ${className ?? ""}`}>
    <label htmlFor={inputId} className={`block font-semibold ${workstation ? "text-base" : "text-sm"}`}>{label}{unit ? <span className="font-normal text-neutral-500"> ({unit})</span> : null}</label>
    <input id={inputId} aria-describedby={hint ? `${inputId}-hint` : undefined} disabled={disabled}
      className={`mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 tabular-nums ${workstation ? "h-16 text-3xl font-black" : "h-11 text-base"}`}
      inputMode={workstation ? "none" : decimal ? "decimal" : "numeric"} autoComplete="off" value={value}
      onFocus={() => { if (workstation) setOpen(true); }} onClick={() => { if (workstation) setOpen(true); }}
      onChange={event => { setCalc({ hint: null, error: null });
        onChange(!workstation && /[=+*/()x×÷-]/i.test(event.target.value) ? cleanArithmeticInput(event.target.value) : cleanNumericInput(event.target.value, decimal).slice(0, maxLength)); }}
      onBlur={() => { if (workstation) return; const out = resolveNumericEntry(value, { decimal, maxDecimals });
        if (out.error || out.hint) { setCalc({ hint: out.hint, error: out.error }); if (!out.error) onChange(out.value.slice(0, maxLength)); } }} />
    {calc.hint ? <p className="mt-1 text-xs text-neutral-600">{calc.hint}</p> : null}
    {calc.error ? <p role="alert" className="mt-1 text-xs text-rose-700">{calc.error}</p> : null}
    {hint ? <p id={`${inputId}-hint`} className="mt-1 text-xs text-neutral-600">{hint}</p> : null}
    {workstation && open && !disabled ? <div role="group" aria-label={`Keypad for ${label}`} className="mt-2 grid grid-cols-3 gap-2 rounded-2xl bg-neutral-100 p-2">
      {KEYPAD_ROWS.flat().map(key => <button key={key} type="button" disabled={key === "." && !decimal}
        aria-label={key === "back" ? "Delete last digit" : key === "." ? "Decimal point" : key}
        onClick={() => press(key)}
        className="flex h-16 min-w-16 items-center justify-center rounded-xl border border-neutral-300 bg-white text-3xl font-black active:bg-neutral-200 disabled:opacity-30">
        {key === "back" ? <Delete className="h-8 w-8" aria-hidden="true" /> : key}</button>)}
      <button type="button" onClick={() => press("clear")} className="h-14 rounded-xl border border-neutral-300 bg-white text-lg font-bold">Clear</button>
      <button type="button" onClick={() => setOpen(false)} className="col-span-2 h-14 rounded-xl bg-neutral-950 text-lg font-bold text-white">Done</button>
    </div> : null}
  </div>;
}
