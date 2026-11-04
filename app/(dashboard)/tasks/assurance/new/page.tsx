import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { AssuranceMutationForm } from "@/components/modules/assurance/mutation-form";
import { getSessionContext } from "@/lib/auth";
import { canUseAssuranceAction, type AssuranceAction } from "@/lib/workflow/assurance";

const standalone: AssuranceAction[] = ["drawing.register", "change.propose", "capability.assess", "capability.criteria", "instrument.register", "instrument.bind", "instrument.policy", "count.open", "return.authorize"];
export default async function NewAssuranceAction({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  const context = await getSessionContext(); const params = await searchParams;
  const action = standalone.find(value => value === params.action);
  if (!action || !canUseAssuranceAction(context.role, action)) redirect("/tasks/assurance");
  return <div className="mx-auto max-w-3xl space-y-5"><PageHeader density="compact" title="Review an assurance action" description="Enter the new facts, then review the server-generated consequence before confirming." actions={<Link href="/tasks/assurance" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Back to assurance</Link>} />
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6"><AssuranceMutationForm key={action} action={action} role={context.role} /></div></div>;
}
