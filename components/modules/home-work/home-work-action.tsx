import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { AssuranceActionCenter } from "@/components/modules/assurance/action-center";
import { ASSURANCE_ACTION_FORMS, AssuranceMutationForm } from "@/components/modules/assurance/mutation-form";
import { CommercialActionCenter } from "@/components/modules/commercial/action-center";
import { COMMERCIAL_ACTION_FORMS, CommercialMutationForm } from "@/components/modules/commercial/mutation-form";
import { ControlActionCenter } from "@/components/modules/control/action-center";
import { CONTROL_ACTION_FORMS, ControlMutationForm } from "@/components/modules/control/mutation-form";
import { CoordinationActionCenter } from "@/components/modules/coordination/action-center";
import { ACTION_FORMS as COORDINATION_ACTION_FORMS, CoordinationMutationForm } from "@/components/modules/coordination/mutation-form";
import { ExecutionActionCenter } from "@/components/modules/execution/action-center";
import { EXECUTION_ACTION_FORMS, ExecutionMutationForm } from "@/components/modules/execution/mutation-form";
import { ImprovementActionCenter } from "@/components/modules/improvement/action-center";
import { IMPROVEMENT_ACTION_FORMS, ImprovementMutationForm } from "@/components/modules/improvement/mutation-form";
import { LifecycleActionCenter } from "@/components/modules/lifecycle/action-center";
import { LIFECYCLE_ACTION_FORMS, LifecycleMutationForm } from "@/components/modules/lifecycle/mutation-form";
import { SpecialistActionCenter } from "@/components/modules/specialist/action-center";
import { SPECIALIST_ACTION_FORMS, SpecialistMutationForm } from "@/components/modules/specialist/mutation-form";
import { getSessionContext } from "@/lib/auth";
import { canUseHubAction } from "@/lib/navigation/hub-permissions";
import { HOME_KINDS, HOME_STARTS, MODULES, MODULE_STARTS, parseWorkAction, type Hub, type HomeKind, type ModuleKey } from "@/lib/navigation/home-work";
import type { AssuranceAction } from "@/lib/workflow/assurance";
import type { CommercialAction } from "@/lib/workflow/commercial";
import type { CoordinationAction } from "@/lib/workflow/coordination";
import type { ExecutionAction } from "@/lib/workflow/execution";
import type { ImprovementAction } from "@/lib/workflow/improvement";
import type { LifecycleAction } from "@/lib/workflow/lifecycle";
import type { ControlAction } from "@/lib/workflow/operations-control";
import type { SpecialistAction } from "@/lib/workflow/specialist";
import type { SessionContext } from "@/types/app";

const TITLES: Record<Hub, Record<string, { title: string }>> = {
  assurance: ASSURANCE_ACTION_FORMS, coordination: COORDINATION_ACTION_FORMS, lifecycle: LIFECYCLE_ACTION_FORMS, improvement: IMPROVEMENT_ACTION_FORMS,
  execution: EXECUTION_ACTION_FORMS, commercial: COMMERCIAL_ACTION_FORMS, specialist: SPECIALIST_ACTION_FORMS, control: CONTROL_ACTION_FORMS
};

function HubForm({ hub, action, role, initial, context }: { hub: Hub; action: string; role: string; initial: Record<string, string>; context: SessionContext }) {
  const key = `${context.companyId}:${context.userId}:${context.role}`;
  switch (hub) {
    case "assurance": return <AssuranceActionCenter key={key} context={context}><AssuranceMutationForm action={action as AssuranceAction} role={role} initial={initial} /></AssuranceActionCenter>;
    case "coordination": return <CoordinationActionCenter key={key} context={context}><CoordinationMutationForm action={action as CoordinationAction} role={role} initial={initial} /></CoordinationActionCenter>;
    case "lifecycle": return <LifecycleActionCenter key={key} context={context}><LifecycleMutationForm action={action as LifecycleAction} role={role} initial={initial} /></LifecycleActionCenter>;
    case "improvement": return <ImprovementActionCenter key={key} context={context}><ImprovementMutationForm action={action as ImprovementAction} role={role} initial={initial} /></ImprovementActionCenter>;
    case "execution": return <ExecutionActionCenter key={key} context={context}><ExecutionMutationForm action={action as ExecutionAction} role={role} initial={initial} /></ExecutionActionCenter>;
    case "commercial": return <CommercialActionCenter key={key} context={context}><CommercialMutationForm action={action as CommercialAction} role={role} initial={initial} /></CommercialActionCenter>;
    case "specialist": return <SpecialistActionCenter key={key} context={context}><SpecialistMutationForm action={action as SpecialistAction} role={role} initial={initial} /></SpecialistActionCenter>;
    case "control": return <ControlActionCenter key={key} context={context}><ControlMutationForm action={action as ControlAction} role={role} initial={initial} /></ControlActionCenter>;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** AP-041: a hub action started from the record (or module) it belongs to. The record id pre-selects; it does not decide. */
export async function HomeWorkAction({ kind, id, module, actionParam }: { kind?: HomeKind; id?: string; module?: ModuleKey; actionParam?: string }) {
  const context = await getSessionContext();
  const back = kind && id ? HOME_KINDS[kind].href(id) : module ? MODULES[module].href : "/dashboard";
  const parsed = parseWorkAction(actionParam);
  const start = parsed && kind ? HOME_STARTS[kind].find(item => item.hub === parsed.hub && item.action === parsed.action)
    : parsed && module ? MODULE_STARTS[module].find(item => item.hub === parsed.hub && item.action === parsed.action) : undefined;
  if (!parsed || !start || context.dealerId || !canUseHubAction(parsed.hub, context.role, parsed.action) || (kind && !UUID.test(id ?? ""))) redirect(back);
  const field: string | null = "field" in start ? (start.field as string | null) : null;
  const initial: Record<string, string> = {};
  if (field && id) initial[field] = id;
  return <div className="mx-auto max-w-3xl space-y-5">
    <PageHeader density="compact" title={TITLES[parsed.hub][parsed.action]?.title ?? start.label} backHref={back}
      backLabel={kind ? `Back to the ${HOME_KINDS[kind].label.toLowerCase()}` : `Back to ${module ? MODULES[module].label.toLowerCase() : "the dashboard"}`}
      description="Enter the facts, then review the server-generated consequence before confirming." />
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6"><HubForm hub={parsed.hub} action={parsed.action} role={context.role} initial={initial} context={context} /></div>
  </div>;
}
