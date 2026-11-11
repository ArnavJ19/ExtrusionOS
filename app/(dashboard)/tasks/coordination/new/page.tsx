import { homeForHubNew } from "@/lib/navigation/home-work";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { CoordinationMutationForm } from "@/components/modules/coordination/mutation-form";
import { getSessionContext } from "@/lib/auth";
import { canUseCoordinationAction, type CoordinationAction } from "@/lib/workflow/coordination";

const standalone: CoordinationAction[] = ["coordinator.propose", "priority.set", "collection.create", "contract.publish", "coverage.propose", "coverage.reconcile", "session.start", "request.create", "steward.assign", "correction.report"];
export default async function NewCoordination({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  const context = await getSessionContext();const params = await searchParams;
  const action = standalone.find(value => value === params.action);
  if (!action || !canUseCoordinationAction(context.role, action)) redirect("/tasks/coordination");
  // AP-041: work that belongs to a record or module now starts there; only configuration stays in this hub.
  const home = homeForHubNew("coordination", action, params as Record<string, string | undefined>);
  if (home) redirect(home);
  return <div className="mx-auto max-w-3xl space-y-5"><PageHeader title="Review a coordination action" description="Choose current source records, enter the new facts, then review the server-generated consequence." actions={<Link href="/tasks/coordination" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Back to coordination</Link>} /><div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6"><CoordinationMutationForm key={action} action={action} role={context.role} /></div></div>;
}
