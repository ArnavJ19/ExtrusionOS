import { homeForHubNew } from "@/lib/navigation/home-work";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { LifecycleMutationForm } from "@/components/modules/lifecycle/mutation-form";
import { getSessionContext } from "@/lib/auth";
import { canUseLifecycleAction, type LifecycleAction } from "@/lib/workflow/lifecycle";

const standalone: LifecycleAction[] = ["sample.require", "template.create", "promise.propose", "trace.open", "trace.link", "bundle.split", "bundle.merge", "journey.open"];
export default async function NewLifecycleAction({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  const context = await getSessionContext(); const params = await searchParams;
  const action = standalone.find(value => value === params.action);
  if (!action || !canUseLifecycleAction(context.role, action)) redirect("/tasks/lifecycle");
  // AP-041: work that belongs to a record or module now starts there; only configuration stays in this hub.
  const home = homeForHubNew("lifecycle", action, params as Record<string, string | undefined>);
  if (home) redirect(home);
  return <div className="mx-auto max-w-3xl space-y-5"><PageHeader density="compact" title="Review a lifecycle action" description="Enter the new facts, then review the server-generated consequence before confirming." actions={<Link href="/tasks/lifecycle" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Back to order lifecycle</Link>} />
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6"><LifecycleMutationForm key={action} action={action} role={context.role} /></div></div>;
}
