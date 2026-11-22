import { CheckCircle2, CircleDashed, OctagonAlert } from "lucide-react";
import { departmentLabel, gateTone, type Gate } from "@/lib/workflow/orchestration";

/** Every production gate with its owning department, so the operator sees exactly what blocks the job and who resolves it. */
export function GateChecklist({ gates, compact = false }: { gates: Gate[]; compact?: boolean }) {
  if (!gates.length) return <p className="text-sm text-slate-600">Gates are evaluated for planned, ready and held jobs.</p>;
  return (
    <ul className={compact ? "space-y-1" : "space-y-2"}>
      {gates.map(gate => {
        const tone = gateTone(gate);
        const Icon = tone === "passed" ? CheckCircle2 : tone === "failed" ? OctagonAlert : CircleDashed;
        return (
          <li key={gate.code} className={`flex min-w-0 items-start gap-2 rounded-xl border px-3 ${compact ? "py-1.5" : "py-2"} text-sm ${tone === "passed" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : tone === "failed" ? "border-red-200 bg-red-50 text-red-950" : "border-amber-200 bg-amber-50 text-amber-950"}`}>
            <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-semibold">
                {gate.label}: {tone === "passed" ? "passed" : tone === "failed" ? "not met" : "advisory"}
                <span className="ml-2 text-xs font-medium">{departmentLabel(gate.department)}{gate.phase === "start" ? " · at start" : ""}{gate.enforced ? " · enforced" : ""}</span>
              </p>
              {gate.message ? <p className="text-xs [overflow-wrap:anywhere]">{gate.message}</p> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
