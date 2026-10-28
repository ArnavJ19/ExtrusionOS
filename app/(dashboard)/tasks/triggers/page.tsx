import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { RecoveryControls, RunTriggersButton } from "@/components/modules/tasks/task-triggers";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/format";
import { TRIGGER_EVENTS, canManageTriggerRules, canUseTriggers, ruleListSchema, ruleSummary, sourceHref, triggeredTaskListSchema } from "@/lib/workflow/task-triggers";

const VIEWS = { rules: "Rules", tasks: "Raised work", unassigned: "Unassigned work" } as const;
type View = keyof typeof VIEWS;
const UNAVAILABLE = ["PGRST202", "42883", "42P01"];

// UPGRADE_EOS feature 64: trigger rules, the work they raised (10 per page), and unassigned work to recover.
export default async function TaskTriggersPage({ searchParams }: { searchParams: Promise<{ view?: string; rule?: string; page?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !canUseTriggers(context.role)) redirect("/tasks");
  const params = await searchParams;
  const view: View = params.view && params.view in VIEWS ? params.view as View : "rules";
  const ruleFilter = params.rule && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.rule) ? params.rule : undefined;
  const page = Math.min(Math.max(Number.parseInt(params.page ?? "1", 10) || 1, 1), 100000);
  const supabase = await createClient();
  const [rulesResult, listResult] = await Promise.all([
    supabase.rpc("task_trigger_command", { p_command: "rules.list", p_payload: {} }),
    view === "rules" ? Promise.resolve(null)
      : supabase.rpc("task_trigger_command", { p_command: view === "unassigned" ? "recovery.list" : "tasks.list", p_payload: { page, ...(view === "tasks" && ruleFilter ? { rule_id: ruleFilter } : {}) } })
  ]);
  const unavailable = Boolean(rulesResult.error && UNAVAILABLE.includes(rulesResult.error.code ?? ""));
  const rulesParsed = rulesResult.error ? null : ruleListSchema.safeParse(rulesResult.data);
  const rules = rulesParsed?.success ? rulesParsed.data : null;
  const listParsed = listResult && !listResult.error ? triggeredTaskListSchema.safeParse(listResult.data) : null;
  const list = listParsed?.success ? listParsed.data : null;
  const unassignedTotal = rules?.rows.reduce((sum, rule) => sum + rule.unassigned_tasks, 0) ?? 0;
  const totalPages = list ? Math.max(1, Math.ceil(list.total_count / 10)) : 1;
  const href = (patch: Record<string, string | number | undefined>) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({ view, rule: ruleFilter, page: 1, ...patch })) if (value !== undefined && !(key === "page" && value === 1) && !(key === "view" && value === "rules")) query.set(key, String(value));
    const text = query.toString();
    return `/tasks/triggers${text ? `?${text}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Task Triggers" description="Rules that raise follow-up work from confirmed events: late dispatches, rejected inspections, long breakdowns, expiring quotations and overdue payments. Each record raises its task once, however often the rules run."
        actions={canManageTriggerRules(context.role) ? <Link href="/tasks/triggers/new" className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-bold text-white">New rule</Link> : null} />

      {!rules ? (
        <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{unavailable ? "Task triggers are not available on this database yet. The database upgrade must be applied first." : "Trigger rules could not be loaded. Refresh to retry."}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
            <p className="text-slate-600">{rules.last_run ? `Last run ${formatDate(rules.last_run.started_at)}: ${rules.last_run.created} assigned, ${rules.last_run.unassigned} unassigned.` : "The rules have not run yet."} Rejected inspections raise work immediately; the other rules run on schedule or here.</p>
            <RunTriggersButton />
          </div>
          {unassignedTotal ? <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">{unassignedTotal} raised task{unassignedTotal === 1 ? " has" : "s have"} no assignee. <Link href={href({ view: "unassigned" })} className="underline">Assign them</Link>.</p> : null}
          <nav className="flex flex-wrap gap-2 text-sm font-bold" aria-label="Trigger views">
            {(Object.keys(VIEWS) as View[]).map((key) => <Link key={key} href={href({ view: key, rule: undefined })} aria-current={key === view ? "page" : undefined} className={`rounded-xl border px-3 py-2 ${key === view ? "border-neutral-950 bg-neutral-950 text-white" : "border-slate-200 bg-white"}`}>{VIEWS[key]}</Link>)}
          </nav>

          {view === "rules" ? (
            !rules.rows.length ? <EmptyState title="No trigger rules yet" description={canManageTriggerRules(context.role) ? "Create a rule so routine follow-up work is raised and assigned without someone remembering to." : "A manager has not set up trigger rules for your team."} /> : (
              <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
                {rules.rows.map((rule) => (
                  <li key={rule.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
                    <div>
                      <p className="font-bold">{rule.name}{rule.is_active ? "" : <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">inactive</span>}</p>
                      <p className="text-xs text-slate-600">{TRIGGER_EVENTS[rule.event_type].label} · {ruleSummary(rule)} · {rule.priority} priority</p>
                    </div>
                    <div className="flex items-center gap-3 text-xs font-semibold">
                      <Link href={href({ view: "tasks", rule: rule.id })} className="underline">{rule.open_tasks} open</Link>
                      {rule.unassigned_tasks ? <span className="text-amber-800">{rule.unassigned_tasks} unassigned</span> : null}
                      {canManageTriggerRules(context.role) ? <Link href={`/tasks/triggers/${rule.id}`} className="underline">Edit</Link> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : !list ? (
            <p role="alert" className="text-sm font-semibold text-amber-900">Raised work could not be loaded. Refresh to retry.</p>
          ) : !list.rows.length ? <EmptyState title={view === "unassigned" ? "Nothing to recover" : "No raised work"} description={view === "unassigned" ? "Every raised task has an assignee." : "The rules have not raised any work yet."} /> : (
            <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
              {list.rows.map((task) => (
                <li key={task.id} className="space-y-2 p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/tasks/${task.id}`} className="font-bold underline-offset-2 hover:underline">{task.title}</Link>
                    <span className="text-xs font-semibold text-slate-600">{task.status.replace("_", " ")} · due {formatDate(task.due_date)}</span>
                  </div>
                  <p className="text-xs text-slate-600">
                    {task.rule_name} · raised {formatDate(task.created_at)} · {task.assignee_name ? `assigned to ${task.assignee_name}` : "unassigned"}
                    {task.assignment_note ? ` · ${task.assignment_note}` : ""} · <Link href={sourceHref(task.source_type, task.source_id)} className="underline">source record</Link>
                    {task.source_open ? "" : <span className="ml-1 font-bold text-emerald-700">· condition resolved, can be closed</span>}
                  </p>
                  {view === "unassigned" ? <RecoveryControls task={task} /> : null}
                </li>
              ))}
            </ul>
          )}
          {list && totalPages > 1 ? (
            <nav className="flex items-center justify-between text-sm font-bold" aria-label="Pages">
              {page > 1 ? <Link href={href({ page: page - 1 })} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Previous</Link> : <span />}
              <span className="text-slate-500">Page {page} of {totalPages}</span>
              {page < totalPages ? <Link href={href({ page: page + 1 })} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Next</Link> : <span />}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
