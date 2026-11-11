import { homeForHubNew } from "@/lib/navigation/home-work";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { SpecialistMutationForm, SPECIALIST_ACTION_FORMS } from "@/components/modules/specialist/mutation-form";
import { getSessionContext } from "@/lib/auth";
import { SPECIALIST_CREATES, canUseSpecialistAction, type SpecialistAction } from "@/lib/workflow/specialist";

const standalone: SpecialistAction[] = Object.values(SPECIALIST_CREATES).flat();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewSpecialistAction({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const context = await getSessionContext(); const params = await searchParams;
  const action = standalone.find(value => value === params.action);
  if (!action || !canUseSpecialistAction(context.role, action)) redirect("/tasks/specialist");
  // AP-041: work that belongs to a record or module now starts there; only configuration stays in this hub.
  const home = homeForHubNew("specialist", action, params as Record<string, string | undefined>);
  if (home) redirect(home);
  // Only identities and known template names are carried from the originating screen; they pre-select, they do not decide.
  const initial: Record<string, string> = {};
  for (const key of ["customer_id", "die_id", "dispatch_id", "order_item_id", "recipe_id"]) if (params[key] && UUID.test(params[key] as string)) initial[key] = params[key] as string;
  return <div className="mx-auto max-w-3xl space-y-5"><PageHeader density="compact" title={SPECIALIST_ACTION_FORMS[action].title} description="Enter the facts, then review the server-generated consequence before confirming."
    actions={<Link href="/tasks/specialist" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Back to specialist workflows</Link>} />
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6"><SpecialistMutationForm key={action} action={action} role={context.role} initial={initial} /></div></div>;
}
