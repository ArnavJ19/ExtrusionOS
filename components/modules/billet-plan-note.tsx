import { planBilletInput, uniformBilletWeightKg } from "@/lib/calculations/production-performance";

// UPGRADE_EOS feature 89: planned input kg = planned good output / expected recovery; billets rounded up.
export function BilletPlanNote({ plannedKg, recoveryPercent, billets, selected }: { plannedKg: unknown; recoveryPercent: unknown; billets: { weight_kg?: unknown }[]; selected: { weight_kg?: unknown }[] }) {
  const billetWeightKg = uniformBilletWeightKg(billets);
  const plan = planBilletInput({ goodOutputKg: plannedKg, recoveryPercent, billetWeightKg });
  const kg = (value: number) => `${value.toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg`;
  if (!plan.ok) return <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">Billet plan: {plan.reason}</p>;
  const selectedKg = selected.reduce((sum, billet) => sum + (Number(billet.weight_kg) || 0), 0);
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
      <p>Billet plan: {kg(plan.goodOutputKg)} planned good output / {plan.recoveryPercent}% expected recovery = <strong>{kg(plan.plannedInputKg)}</strong> planned billet input.</p>
      <p className="mt-1">
        {plan.billetCount !== null && plan.billetWeightKg !== null
          ? <>{kg(plan.plannedInputKg)} / {kg(plan.billetWeightKg)} per billet = <strong>{plan.billetCount} billets</strong> (rounded up).</>
          : "Compatible billets have different weights, so the count depends on which billets are selected."}
        {selected.length ? <> Selected billets: {kg(selectedKg)} nominal ({selectedKg >= plan.plannedInputKg ? "covers" : "short of"} the planned input).</> : null}
      </p>
    </div>
  );
}
