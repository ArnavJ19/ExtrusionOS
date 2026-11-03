import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ControlMutationForm } from "@/components/modules/control/mutation-form";
import { getSessionContext } from "@/lib/auth";
import { canUseControlAction, type ControlAction } from "@/lib/workflow/operations-control";

const standalone: ControlAction[] = ["plan.generate", "policy.set", "supply.link", "authority.publish", "contract.publish"];
export default async function NewControlAction({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  const context = await getSessionContext(); const params = await searchParams;
  const action = standalone.find(value => value === params.action);
  if (!action || !canUseControlAction(context.role, action)) redirect("/tasks/control");
  return <div className="mx-auto max-w-3xl space-y-5"><PageHeader title="Review an operational control action" description="Enter the new facts, then review the server-generated consequence before confirming." actions={<Link href="/tasks/control" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Back to controls</Link>} />
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6"><ControlMutationForm key={action} action={action} role={context.role} /></div></div>;
}
