// AP-041: one place that asks each hub's own permission mirror whether a role may start a hub action or read a view.
import { canReadAssurance, canUseAssuranceAction, type AssuranceAction } from "../workflow/assurance.ts";
import { canReadCommercial, canUseCommercialAction, type CommercialAction } from "../workflow/commercial.ts";
import { canReadCoordination, canUseCoordinationAction, type CoordinationAction } from "../workflow/coordination.ts";
import { canReadExecution, canUseExecutionAction, type ExecutionAction } from "../workflow/execution.ts";
import { canReadImprovement, canUseImprovementAction, type ImprovementAction } from "../workflow/improvement.ts";
import { canReadLifecycle, canUseLifecycleAction, type LifecycleAction } from "../workflow/lifecycle.ts";
import { canReadControl, canUseControlAction, type ControlAction } from "../workflow/operations-control.ts";
import { canReadSpecialist, canUseSpecialistAction, type SpecialistAction } from "../workflow/specialist.ts";
import type { Hub } from "./home-work.ts";

export function canUseHubAction(hub: Hub, role: string, action: string): boolean {
  try {
    switch (hub) {
      case "assurance": return canReadAssurance(role) && canUseAssuranceAction(role, action as AssuranceAction);
      case "coordination": return canReadCoordination(role) && canUseCoordinationAction(role, action as CoordinationAction);
      case "lifecycle": return canReadLifecycle(role) && canUseLifecycleAction(role, action as LifecycleAction);
      case "improvement": return canReadImprovement(role) && canUseImprovementAction(role, action as ImprovementAction);
      case "execution": return canReadExecution(role) && canUseExecutionAction(role, action as ExecutionAction);
      case "commercial": return canReadCommercial(role) && canUseCommercialAction(role, action as CommercialAction);
      case "specialist": return canReadSpecialist(role) && canUseSpecialistAction(role, action as SpecialistAction);
      case "control": return canReadControl(role) && canUseControlAction(role, action as ControlAction);
    }
  } catch { return false; }
  return false;
}
