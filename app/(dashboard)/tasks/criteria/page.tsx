import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ReopenTask } from "@/components/modules/tasks/completion-criteria";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/format";
import { CRITERION_KINDS, canManageTemplates, canSuperviseCriteria, criterionRule, reviewListSchema, templateListSchema } from "@/lib/workflow/completion-criteria";

// UPGRADE_EOS feature 67: standard criteria per kind of task, and completed work whose outcome no longer holds.
export default async function CompletionCriteriaPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !canSuperviseCriteria(context.role)) redirect("/tasks");
  const page = Math.min(Math.max(Number.parseInt((await searchParams).page ?? "1", 10) || 1, 1), 100000);
  const supabase = await createClient();
  const [templatesResult, reviewResult] = await Promise.all([
    supabase.rpc("task_criteria_command", { p_command: "templates.list", p_payload: {} }),
    supabase.rpc("task_criteria_command", { p_command: "review.list", p_payload: { page } })
  ]);
  const unavailable = Boolean(templatesResult.error && ["PGRST202", "42883", "42P01"].includes(templatesResult.error.code ?? ""));
  const templatesParsed = templatesResult.error ? null : templateListSchema.safeParse(templatesResult.data);
  const templates = templatesParsed?.success ? templatesParsed.data : null;
  const reviewParsed = reviewResult.error ? null : reviewListSchema.safeParse(reviewResult.data);
  const review = reviewParsed?.success ? reviewParsed.data : null;
  const totalPages = review ? Math.max(1, Math.ceil(review.total_count / 10)) : 1;

  return (
    <div className="space-y-5">
      <PageHeader title="Completion Criteria" description="The business outcome a task must reach before it can be completed, checked against current records. Standard criteria attach to new tasks of a kind; supervisors can add or remove criteria on one task."
        actions={canManageTemplates(context.role) ? <Link href="/tasks/criteria/new" className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-bold text-white">New standard criterion</Link> : null} />
      {!templates ? (
        <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{unavailable ? "Completion criteria are not available on this database yet. The database upgrade must be applied first." : "Criteria could not be loaded. Refresh to retry."}</p>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">Completed, but no longer met{review ? ` (${review.total_count})` : ""}</h2>
            {!review ? <p className="text-sm text-amber-900">The review list could not be loaded.</p> : !review.rows.length ? <p className="text-sm text-slate-600">No completed task has had its outcome reversed.</p> : (
              <ul className="divide-y divide-slate-100 rounded-2xl border border-amber-200 bg-white">
                {review.rows.map((row) => (
                  <li key={row.id} className="space-y-2 p-4 text-sm">
                    <div className="flex flex-wrap justify-between gap-2"><Link href={`/tasks/${row.id}`} className="font-bold underline-offset-2 hover:underline">{row.title}</Link><span className="text-xs text-slate-600">completed {formatDate(row.completed_at)}{row.assignee_name ? ` by ${row.assignee_name}` : ""}</span></div>
                    <ul className="text-xs font-semibold text-amber-900">{row.evaluation.criteria.filter((c) => !c.met).map((c) => <li key={c.id}>{c.label}: {c.reason}</li>)}</ul>
                    <ReopenTask taskId={row.id} />
                  </li>
                ))}
              </ul>
            )}
            {review && totalPages > 1 ? (
              <nav className="flex items-center justify-between text-sm font-bold" aria-label="Pages">
                {page > 1 ? <Link href={`/tasks/criteria?page=${page - 1}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Previous</Link> : <span />}
                <span className="text-slate-500">Page {page} of {totalPages}</span>
                {page < totalPages ? <Link href={`/tasks/criteria?page=${page + 1}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Next</Link> : <span />}
              </nav>
            ) : null}
          </section>
          <section className="space-y-2">
            <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">Standard criteria</h2>
            {!templates.length ? <EmptyState title="No standard criteria" description="Add criteria so tasks such as dispatch follow-ups or packaging handoffs close only when the work is really done." /> : (
              <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
                {templates.map((template) => (
                  <li key={template.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
                    <div>
                      <p className="font-bold">{template.label}{template.is_active ? "" : <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">not attached</span>}</p>
                      <p className="text-xs text-slate-600">{template.task_kind} · {CRITERION_KINDS[template.kind]} · {criterionRule(template)}</p>
                    </div>
                    {canManageTemplates(context.role) ? <Link href={`/tasks/criteria/${template.id}`} className="text-xs font-bold underline">Edit</Link> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
