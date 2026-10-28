import type { buildProductionJobEvidence } from "@/lib/calculations/production-performance";
import { formatPercent, formatWeight } from "@/lib/utils/format";

type Evidence = ReturnType<typeof buildProductionJobEvidence>;

const NOT_CAPTURED = "Not captured";

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-black text-slate-950">{value}</p>
      <p className="mt-0.5 text-xs font-semibold text-slate-500">{hint}</p>
    </div>
  );
}

function balanceTone(status: "balanced" | "unaccounted" | "over_accounted", withinTolerance: boolean) {
  if (status === "balanced") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  return withinTolerance ? "border-amber-200 bg-amber-50 text-amber-900" : "border-red-200 bg-red-50 text-red-900";
}

export function ProductionPerformancePanel({ evidence }: { evidence: Evidence }) {
  const { billetInput, performance, balance } = evidence;
  const percent = (value: number | null) => (value === null ? NOT_CAPTURED : formatPercent(value));
  const inputHint = billetInput.count === 0
    ? evidence.inputExceptionRecorded ? "No billets linked; a manager input exception is recorded." : "No billets are linked to this job."
    : `${billetInput.count} billet${billetInput.count === 1 ? "" : "s"}: ${billetInput.measuredCount} measured, ${billetInput.nominalOnlyCount} nominal weight only.`;

  return (
    <section aria-labelledby="production-performance-title" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Recorded transactions</p>
      <h2 id="production-performance-title" className="section-title mt-1">Performance and material balance</h2>
      <p className="mt-1 max-w-3xl text-sm font-medium text-slate-500">
        Calculated only from issued billets, recorded good output and posted scrap. Missing evidence shows as {NOT_CAPTURED.toLowerCase()}; nothing here changes stock or scrap.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Issued input" value={billetInput.count > 0 && billetInput.missingWeightCount === 0 ? formatWeight(billetInput.inputKg) : NOT_CAPTURED} hint={inputHint} />
        <Metric label="Recovery" value={percent(performance.recoveryPercent)} hint="Good output kg / issued input kg x 100" />
        <Metric label="Scrap" value={percent(performance.scrapPercent)} hint={evidence.scrapKg === null ? "Scrap postings could not be read." : `${formatWeight(evidence.scrapKg)} posted scrap / issued input`} />
        <Metric label="Plan attainment" value={percent(performance.planAttainmentPercent)} hint="Good output kg / planned output kg x 100" />
      </div>

      <div className="mt-4">
        {balance.status === "not_captured" ? (
          <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">Material balance: {balance.reason}</p>
        ) : (
          <div className={`rounded-2xl border px-4 py-3 text-sm ${balanceTone(balance.status, balance.withinTolerance)}`}>
            <p className="font-black">
              {balance.status === "balanced"
                ? "Fully accounted"
                : balance.status === "unaccounted"
                  ? `${formatWeight(balance.differenceKg)} unaccounted`
                  : `${formatWeight(-balance.differenceKg)} more recorded than issued input`}
              {balance.status !== "balanced" ? ` (${balance.withinTolerance ? "within" : "outside"} the ${formatWeight(balance.toleranceKg)} completion tolerance)` : null}
            </p>
            <p className="mt-1 font-semibold">
              Input {formatWeight(balance.inputKg)} - ({balance.lines.map((line) => `${line.label.toLowerCase()} ${formatWeight(line.kg)}`).join(" + ")}) = {formatWeight(balance.differenceKg)}
            </p>
            {balance.status !== "balanced" ? (
              <p className="mt-1 text-xs font-semibold">This difference is reported only. Classify it through an authorised output correction or scrap posting; it is not recorded as scrap automatically.</p>
            ) : null}
          </div>
        )}
        {evidence.reversedScrapKg > 0 ? (
          <p className="mt-2 text-xs font-semibold text-slate-500">Excluded {formatWeight(evidence.reversedScrapKg)} of reversed scrap postings.</p>
        ) : null}
      </div>
    </section>
  );
}
