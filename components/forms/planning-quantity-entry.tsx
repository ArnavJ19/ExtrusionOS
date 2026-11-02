"use client";

import { useId, useState } from "react";
import { derivePlanningQuantity, planningLengthConflicts, type PlanningQuantityBasis, type PlanningQuantity } from "@/lib/calculations/planning-quantity";
import { displayLength, lengthUnits, parseLengthInput, type LengthUnit } from "@/lib/calculations/length-units";
import { formatNumeric } from "@/lib/utils/numeric-display";

export function PlanningQuantityEntry({ sectionWeight, weightSourceLabel, sourceLengthM, onApply }: { sectionWeight: number | null; weightSourceLabel: string; sourceLengthM?: number | null; onApply: (basis: PlanningQuantityBasis, quantity: PlanningQuantity) => void }) {
  const id = useId();
  const [pieces, setPieces] = useState("");
  const [length, setLength] = useState("");
  const [unit, setUnit] = useState<LengthUnit>("m");
  const result = derivePlanningQuantity({ pieces: pieces.trim() ? Number(pieces) : null, length, unit, sectionWeightKgPerM: sectionWeight });
  const lengthConflict = Boolean(result.data && planningLengthConflicts(result.data.lengthPerPieceM, sourceLengthM));
  return <details className="mb-5 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
    <summary className="min-h-11 cursor-pointer py-2 font-bold">Plan from pieces and cut length</summary>
    <p className="my-2 text-sm text-neutral-600">Uses {weightSourceLabel.toLowerCase()}. Applying this replaces planned kg, pieces and cut length. The order specification remains authoritative; actual scale readings and billing quantities stay separate.</p>
    <div className="grid gap-3 sm:grid-cols-3">
      <div><label htmlFor={`${id}-pieces`} className="text-sm font-semibold">Known pieces</label><input id={`${id}-pieces`} className="form-input mt-1" inputMode="numeric" value={pieces} onChange={(event) => setPieces(event.target.value)} /></div>
      <div><label htmlFor={`${id}-length`} className="text-sm font-semibold">Cut length per piece</label><input id={`${id}-length`} className="form-input mt-1" inputMode="decimal" value={length} onChange={(event) => setLength(event.target.value)} /></div>
      <div><label htmlFor={`${id}-unit`} className="text-sm font-semibold">Length unit</label><select id={`${id}-unit`} className="form-input mt-1" value={unit} onChange={(event) => {
        const next = event.target.value as LengthUnit;
        const currentLength = parseLengthInput(length, unit);
        if (currentLength.metres !== undefined) setLength(displayLength(currentLength.metres, next));
        setUnit(next);
      }}>{Object.entries(lengthUnits).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
    </div>
    <p className="mt-3 text-sm">Section weight: {sectionWeight === null ? "Unavailable" : `${sectionWeight} kg/m`}</p>
    {sourceLengthM ? <p className="mt-1 text-sm">Order-line cut length: {sourceLengthM} m per piece. Change the order specification before planning a different length.</p> : null}
    <p role="status" className="mt-2 text-sm">{lengthConflict ? "Cut length differs from the order line. Use the specified length or review the order first." : result.data ? `${result.data.lengthPerPieceM.toFixed(3)} m per piece as saved (nearest mm); ${formatNumeric(result.data.totalMetres, "metres")} total; ${formatNumeric(result.data.theoreticalKg, "weight")} theoretical planned output` : result.error}</p>
    <button type="button" disabled={!result.data || lengthConflict} className="mt-3 min-h-11 rounded-xl border border-neutral-300 bg-white px-4 text-sm font-bold disabled:opacity-50" onClick={() => {
      if (result.data && !lengthConflict && sectionWeight !== null) onApply({ pieces: result.data.pieces, length, unit, sectionWeightKgPerM: sectionWeight }, result.data);
    }}>Apply theoretical plan</button>
  </details>;
}
