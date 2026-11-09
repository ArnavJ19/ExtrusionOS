import { homeForHubNew } from "@/lib/navigation/home-work";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ExecutionMutationForm, EXECUTION_ACTION_FORMS } from "@/components/modules/execution/mutation-form";
import { getSessionContext } from "@/lib/auth";
import { MESSAGE_TEMPLATES, canUseExecutionAction, type ExecutionAction } from "@/lib/workflow/execution";

const standalone: ExecutionAction[] = ["appointment.request", "gatepass.issue", "window.set", "window.request", "wip.set_limit", "rule.set", "availability.record", "route.define", "route.bind", "message.prepare"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewExecutionAction({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const context = await getSessionContext(); const params = await searchParams;
  const action = standalone.find(value => value === params.action);
  if (!action || !canUseExecutionAction(context.role, action)) redirect("/tasks/execution");
  // AP-041: work that belongs to a record or module now starts there; only configuration stays in this hub.
  const home = homeForHubNew("execution", action, params as Record<string, string | undefined>);
  if (home) redirect(home);
  // Only identities and known template names are carried from the originating screen; they pre-select, they do not decide.
  const initial: Record<string, string> = {};
  for (const key of ["order_id", "dispatch_id", "entity_id", "job_id"]) if (params[key] && UUID.test(params[key] as string)) initial[key] = params[key] as string;
  if (params.template && Object.hasOwn(MESSAGE_TEMPLATES, params.template)) initial.template = params.template;
  return <div className="mx-auto max-w-3xl space-y-5"><PageHeader density="compact" title={EXECUTION_ACTION_FORMS[action].title} description="Enter the facts, then review the server-generated consequence before confirming."
    actions={<Link href="/tasks/execution" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Back to execution planning</Link>} />
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6"><ExecutionMutationForm key={action} action={action} role={context.role} initial={initial} /></div></div>;
}
