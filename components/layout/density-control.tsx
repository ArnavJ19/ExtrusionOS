"use client";

import { useEffect, useState } from "react";
import { DEFAULT_DENSITY, browserStore, readDensity, resetDensity, writeDensity, type Density, type DensityScope } from "@/lib/preferences/density";

/** NOV-082: comfortable or compact spacing for this device. Warnings, validation and confirmation summaries are never compacted. */
export function DensityControl({ scope }: { scope: DensityScope }) {
  const [density, setDensity] = useState<Density>(DEFAULT_DENSITY);
  const [saved, setSaved] = useState(true);
  useEffect(() => {
    const stored = readDensity(browserStore(), scope);
    setDensity(stored); document.documentElement.dataset.density = stored;
  }, [scope.companyId, scope.userId]);
  function choose(next: Density) {
    setDensity(next); document.documentElement.dataset.density = next;
    setSaved(writeDensity(browserStore(), scope, next));
  }
  function reset() {
    setDensity(DEFAULT_DENSITY); document.documentElement.dataset.density = DEFAULT_DENSITY;
    setSaved(resetDensity(browserStore(), scope));
  }
  const button = (value: Density, label: string) => <button type="button" aria-pressed={density === value} onClick={() => choose(value)}
    className={`min-h-10 rounded-xl px-3 text-xs font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-900 ${density === value ? "bg-neutral-950 text-white" : "bg-white text-neutral-700"}`}>{label}</button>;
  return <div role="group" aria-label="Display density" className="flex items-center gap-1 rounded-2xl border border-neutral-200 bg-white p-1 shadow-sm">
    {button("comfortable", "Comfortable")}{button("compact", "Compact")}
    {density !== DEFAULT_DENSITY ? <button type="button" onClick={reset} className="min-h-10 rounded-xl px-2 text-xs font-semibold text-neutral-600 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-900">Reset</button> : null}
    {!saved ? <span role="status" className="px-1 text-[11px] font-semibold text-amber-800">Not saved on this device</span> : null}
  </div>;
}
