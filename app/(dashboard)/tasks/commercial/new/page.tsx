import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { CommercialMutationForm, COMMERCIAL_ACTION_FORMS } from "@/components/modules/commercial/mutation-form";
import { getSessionContext } from "@/lib/auth";
import { canUseCommercialAction, type CommercialAction } from "@/lib/workflow/commercial";

const standalone: CommercialAction[] = ["pricing.define", "pricing.price", "claim.submit", "commitment.set", "outcome.record", "remnant.record", "mapping.define", "transfer.prepare", "scenario.create"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewCommercialAction({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const context = await getSessionContext(); const params = await searchParams;
  const action = standalone.find(value => value === params.action);
  if (!action || !canUseCommercialAction(context.role, action)) redirect("/tasks/commercial");
  // Only identities and known template names are carried from the originating screen; they pre-select, they do not decide.
  const initial: Record<string, string> = {};
  for (const key of ["quote_id", "customer_id", "purchase_order_id", "profile_id"]) if (params[key] && UUID.test(params[key] as string)) initial[key] = params[key] as string;
  return <div className="mx-auto max-w-3xl space-y-5"><PageHeader density="compact" title={COMMERCIAL_ACTION_FORMS[action].title} description="Enter the facts, then review the server-generated consequence before confirming."
    actions={<Link href="/tasks/commercial" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Back to commercial and planning</Link>} />
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6"><CommercialMutationForm key={action} action={action} role={context.role} initial={initial} /></div></div>;
}
