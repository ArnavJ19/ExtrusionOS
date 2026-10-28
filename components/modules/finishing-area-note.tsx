import { explainFinishingArea } from "@/lib/calculations/quote";
import { formatCurrency } from "@/lib/utils/format";

// UPGRADE_EOS feature 84: shows how a per-sq-ft finishing charge was derived for one quote line.
export function FinishingAreaNote({ totalMeters, perimeterMm, ratePerSqft, perimeterSource }: { totalMeters: number; perimeterMm: number | null | undefined; ratePerSqft: number; perimeterSource: string }) {
  const area = explainFinishingArea(totalMeters, perimeterMm, ratePerSqft);
  const number = (value: number, digits = 3) => value.toLocaleString("en-IN", { maximumFractionDigits: digits });
  if (!area.ok) {
    return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 md:col-span-4">Finishing area: {area.reason}</p>;
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 md:col-span-4">
      <p>Finishing area: {number(area.totalMeters)} m x {number(area.perimeterMm, 2)} mm coating perimeter / 1,000 = <strong>{number(area.areaM2)} m2</strong> = <strong>{number(area.areaSqft)} sq ft</strong>.</p>
      <p className="mt-1">{number(area.areaSqft)} sq ft x {formatCurrency(ratePerSqft)}/sq ft = <strong>{formatCurrency(area.charge)}</strong> finishing charge. Perimeter source: {perimeterSource}.</p>
    </div>
  );
}
