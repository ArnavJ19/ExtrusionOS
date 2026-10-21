"use client";

import { useId, useState } from "react";
import { billetDimensionUnits, convertBilletDimension, estimateBilletGeometry, type BilletDimensionUnit } from "@/lib/calculations/billet-estimate";

function capturedNumber(value: unknown) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function BilletWeightEstimate({ lengthMm, diameterMm, densityKgPerM3, count, alloy, source }: {
  lengthMm: unknown; diameterMm: unknown; densityKgPerM3: unknown; count: unknown; alloy: string; source: string;
}) {
  const id = useId();
  const [unit, setUnit] = useState<BilletDimensionUnit>("mm");
  const length = capturedNumber(lengthMm);
  const diameter = capturedNumber(diameterMm);
  const density = capturedNumber(densityKgPerM3);
  const billetCount = capturedNumber(count);
  const estimate = estimateBilletGeometry({ length, lengthUnit: "mm", diameter, diameterUnit: "mm", densityKgPerM3: density, count: billetCount });
  const display = (value: number | null) => value == null ? "Not captured" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 9 }).format(value);
  return (
    <section aria-labelledby={`${id}-title`} className="mt-4 rounded-2xl border border-orange/20 bg-orange/5 p-4 text-sm text-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={`${id}-title`} className="font-black text-slate-950">Theoretical billet weight</h3>
        <label className="flex items-center gap-2 text-xs font-semibold" htmlFor={`${id}-unit`}>Display dimensions in
          <select id={`${id}-unit`} value={unit} onChange={(event) => setUnit(event.target.value as BilletDimensionUnit)} className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm">
            {billetDimensionUnits.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
      </div>
      <p className="mt-2 text-xs">Source: {source}. Alloy: {alloy || "Not captured"}. Density assumption: {display(density)} kg/m3 from the current batch configuration. Confirm its suitability before planning.</p>
      <p className="mt-2 break-words">Length {display(length == null ? null : convertBilletDimension(length, "mm", unit))} {unit}; diameter {display(diameter == null ? null : convertBilletDimension(diameter, "mm", unit))} {unit}; count {display(billetCount)}.</p>
      {estimate.ok ? <>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2" aria-live="polite">
          <div><dt className="text-xs font-semibold">Estimated kg per billet</dt><dd className="text-xl font-black text-slate-950">{estimate.eachKg.toFixed(3)} kg</dd></div>
          <div><dt className="text-xs font-semibold">Estimated batch kg</dt><dd className="text-xl font-black text-slate-950">{estimate.totalKg.toFixed(3)} kg</dd></div>
        </dl>
        <details className="mt-3"><summary className="cursor-pointer font-semibold">Show calculation and precision</summary>
          <p className="mt-2 break-words">kg = pi x (diameter m / 2)^2 x length m x density kg/m3. Using diameter {display(estimate.diameterM)} m, length {display(estimate.lengthM)} m, and density {display(density)} kg/m3.</p>
          <p className="mt-1">Each billet is rounded to 0.001 kg before multiplying by {display(billetCount)}, matching the batch planning calculation.</p>
        </details>
      </> : <p role="status" className="mt-3 font-semibold text-amber-900">Estimate unavailable. {estimate.reason}</p>}
      <p className="mt-3 text-xs font-semibold">Planning estimate only. Actual measured mass is recorded separately; changing these assumptions does not record a weighing or update issued material.</p>
    </section>
  );
}
