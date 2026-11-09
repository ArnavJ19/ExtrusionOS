import { homeForHubNew } from "@/lib/navigation/home-work";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ImprovementMutationForm } from "@/components/modules/improvement/mutation-form";
import { getSessionContext } from "@/lib/auth";
import { canUseImprovementAction, suggestionSourcePath, type ImprovementAction } from "@/lib/workflow/improvement";

const standalone: ImprovementAction[] = ["problem.open", "suggestion.submit", "route.set", "threshold.propose"];
export default async function NewImprovementAction({ searchParams }: { searchParams: Promise<{ action?: string; from?: string }> }) {
  const context = await getSessionContext(); const params = await searchParams;
  const action = standalone.find(value => value === params.action);
  if (!action || !canUseImprovementAction(context.role, action)) redirect("/tasks/improvement");
  // AP-041: work that belongs to a record or module now starts there; only configuration stays in this hub.
  const home = homeForHubNew("improvement", action, params as Record<string, string | undefined>);
  if (home) redirect(home);
  // NOV-059: only the page path of the originating screen is kept; its query string may hold draft values.
  const source = suggestionSourcePath(typeof params.from === "string" ? params.from : "/tasks/improvement");
  const fixed = action === "suggestion.submit" ? { source_path: source } : {};
  return <div className="mx-auto max-w-3xl space-y-5"><PageHeader density="compact" title={action === "suggestion.submit" ? "Suggest an improvement" : "Review an improvement action"}
    description={action === "suggestion.submit" ? "Tell the process owner what slowed you down. You will see their response under My suggestions." : "Enter the new facts, then review the server-generated consequence before confirming."}
    actions={<Link href={action === "suggestion.submit" && source !== "/" ? source : "/tasks/improvement"} className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">{action === "suggestion.submit" && source !== "/" ? "Back to the screen" : "Back to improvement"}</Link>} />
    {action === "suggestion.submit" ? <p className="rounded-xl bg-slate-50 p-3 text-sm">Screen: <span className="font-semibold">{source}</span></p> : null}
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6"><ImprovementMutationForm key={action} action={action} role={context.role} fixed={fixed} /></div></div>;
}
