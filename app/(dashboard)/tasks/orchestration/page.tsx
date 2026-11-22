import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { FloorLanguageToggle } from "@/components/modules/autopilot-batch9/floor-language";
import { LiveRefresh } from "@/components/modules/intelligence/live";
import { TaskActions } from "@/components/modules/orchestration/task-actions";
import { getSessionContext } from "@/lib/auth";
import { orchestrationAction } from "@/lib/actions/orchestration";
import { floorText, isFloorKey, type FloorKey, type FloorText } from "@/lib/i18n/floor";
import { getFloorLanguage } from "@/lib/i18n/floor-server";
import { TASK_KIND_LABELS, canReadOrchestration, departmentLabel, inboxSchema, taskWorkLink } from "@/lib/workflow/orchestration";

const VIEWS = ["mine", "department", "overdue", "escalated", "completed", "all"] as const;
type View = (typeof VIEWS)[number];
const at = (value: string | null) => (value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
/** A catalogue label for a record value, else the English label the module already has. */
const label = (t: FloorText, key: string, fallback: string) => (isFloorKey(key) ? t(key) : fallback);

export default async function OrchestrationTasksPage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string }> }) {
  const [q, context, lang] = await Promise.all([searchParams, getSessionContext(), getFloorLanguage()]);
  if (context.dealerId || !canReadOrchestration(context.role)) redirect("/tasks");
  const t = floorText(lang);
  const view = (VIEWS.includes(q.view as View) ? q.view : "mine") as View;
  const page = Math.min(Math.max(Number.parseInt(q.page ?? "1", 10) || 1, 1), 100000);
  const result = await orchestrationAction({ command: "tasks.inbox", view, page });
  const parsed = result.success ? inboxSchema.safeParse(result.data) : null;
  const inbox = parsed?.success ? parsed.data : null;
  const href = (p: number) => `?${new URLSearchParams({ view, page: String(p) })}`;
  const dept = (d: string) => label(t, `olo.dept.${d}`, departmentLabel(d));
  return (
    <div className="space-y-5" lang={lang}>
      <PageHeader title={t("olo.tasks.title")} description={t("olo.tasks.desc")}
        actions={<div className="flex flex-wrap items-center gap-2"><LiveRefresh name="workflow-tasks" tables={["olo_task_events"]} /><FloorLanguageToggle lang={lang} />
          <Link href="/orders/lifecycle" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">{t("olo.tasks.commandCentre")}</Link></div>} />
      {!inbox ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : t("olo.tasks.loadFailed")}</p> : <>
        <nav className="flex flex-wrap gap-2" aria-label={t("olo.tasks.title")}>{VIEWS.map(k => {
          const count = k in inbox.counts ? inbox.counts[k as keyof typeof inbox.counts] : null;
          return <Link key={k} href={`?view=${k}`} className={`rounded-xl border px-3 py-2 text-sm font-bold ${view === k ? "border-orange bg-orange/10" : "bg-white"}`}>{t(`olo.view.${k}` as FloorKey)}{count !== null ? ` (${count})` : ""}</Link>;
        })}</nav>
        {view === "department" ? <p className="text-sm text-slate-600">{t("olo.tasks.myDepts", { list: inbox.departments.length ? inbox.departments.map(dept).join(", ") : t("olo.tasks.none") })}</p> : null}
        {inbox.rows.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">{t("olo.tasks.empty")}</p> : (
          <ul className="space-y-3">{inbox.rows.map(task => {
            const work = taskWorkLink({ kind: task.kind, order_id: task.order_id, job_id: task.job_id, source_id: (task as { source_id?: string | null }).source_id ?? null });
            return (
              <li key={task.id} className={`rounded-2xl border bg-white p-4 ${task.escalation_level >= 2 ? "border-red-300" : task.escalation_level === 1 ? "border-amber-300" : "border-slate-200"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase text-slate-500">{label(t, `olo.kind.${task.kind}`, TASK_KIND_LABELS[task.kind] ?? task.kind)} · {dept(task.department)} · {label(t, `olo.priority.${task.priority}`, task.priority)}
                      {task.cycle > 1 ? ` · ${t("olo.tasks.cycle", { n: task.cycle })}` : ""}{task.escalation_level ? ` · ${t("olo.tasks.escalated", { n: task.escalation_level })}` : ""}</p>
                    <h2 className="font-bold [overflow-wrap:anywhere]">{task.title}</h2>
                    <p className="text-xs text-slate-600">{task.order_id ? <Link className="underline" href={`/orders/${task.order_id}/lifecycle`}>{task.order_number}</Link> : null}{task.job_id ? <> · <Link className="underline" href={`/production/${task.job_id}`}>{task.job_number}</Link></> : null}
                      {" · "}{task.assignee_name ?? t("olo.tasks.unassigned")} · {t("olo.tasks.due", { at: at(task.due_at) })} · {task.acknowledged_at ? t("olo.tasks.ackBy", { name: task.acknowledged_by_name, at: at(task.acknowledged_at) }) : t("olo.tasks.notAck")}</p>
                  </div>
                  <span className="rounded-full border px-2 py-0.5 text-xs font-bold">{label(t, `olo.status.${task.status}`, task.status.replace(/_/g, " "))}</span>
                </div>
                {task.description ? <p className="mt-2 text-sm [overflow-wrap:anywhere]" lang="en">{task.description}</p> : null}
                {task.system_resolution ? <p className="mt-2 text-sm font-semibold text-emerald-800" lang="en">{task.system_resolution}</p> : null}
                {task.can_act ? <div className="mt-3 flex flex-wrap items-center gap-3">
                  <TaskActions taskId={task.id} status={task.status} acknowledged={Boolean(task.acknowledged_at)} labels={{ acknowledge: t("olo.task.acknowledge"), start: t("olo.task.start") }} />
                  <Link className="text-sm font-bold underline" href={work.href}>{label(t, `olo.work.${task.kind}`, label(t, "olo.work.default", work.label))}</Link></div> : null}
              </li>
            );
          })}</ul>
        )}
        {inbox.total > inbox.page_size ? <nav className="flex justify-between text-sm font-semibold">{page > 1 ? <Link href={href(page - 1)}>{t("common.previous")}</Link> : <span />}<span>{t("olo.tasks.pageOf", { n: page, total: Math.ceil(inbox.total / inbox.page_size) })}</span>{page * inbox.page_size < inbox.total ? <Link href={href(page + 1)}>{t("common.next")}</Link> : <span />}</nav> : null}
      </>}
    </div>
  );
}
