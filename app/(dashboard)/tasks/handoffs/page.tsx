import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { HandoffQueueList, ReprocessHandoff } from "@/components/modules/tasks/department-handoffs";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { turnaroundStatusSchema, type TurnaroundStatus } from "@/lib/workflow/turnaround";
import { HANDOFF_TEAMS, acceptanceStatusSchema, canReadHandoffs, canReprocessHandoffs, handoffQueueSchema, teamsForRole, type AcceptanceStatus, type HandoffTeam } from "@/lib/workflow/department-handoffs";

const statuses = { active: "Open and in progress", open: "Waiting", in_progress: "In progress", completed: "Completed" } as const;
type Status = keyof typeof statuses;

// UPGRADE_EOS feature 14: handoffs created from QC release, finishing receipt and completed packaging.
export default async function DepartmentHandoffsPage({ searchParams }: { searchParams: Promise<{ team?: string; status?: string; page?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !canReadHandoffs(context.role)) redirect("/tasks");
  const params = await searchParams;
  const team = Object.hasOwn(HANDOFF_TEAMS, params.team ?? "") ? (params.team as HandoffTeam) : undefined;
  const status: Status = Object.hasOwn(statuses, params.status ?? "") ? (params.status as Status) : "active";
  const page = Math.min(Math.max(Number.parseInt(params.page ?? "1", 10) || 1, 1), 100000);
  const supabase = await createClient();
  const result = await supabase.rpc("department_handoff_command", { p_command: "handoff.list", p_payload: { status, page, ...(team ? { team } : {}) } });
  const parsed = result.error ? null : handoffQueueSchema.safeParse(result.data);
  const unavailable = Boolean(result.error && ["PGRST202", "42883", "42P01"].includes(result.error.code ?? ""));
  const queue = parsed?.success ? parsed.data : null;
  const totalPages = queue ? Math.max(1, Math.ceil(queue.total_count / 10)) : 1;
  // UPGRADE_EOS feature 69: acceptance state for the handoffs on this page (absent before the upgrade).
  let acceptance: Record<string, AcceptanceStatus> = {};
  if (queue?.rows.length) {
    const statusResult = await supabase.rpc("handoff_acceptance_command", { p_command: "acceptance.status", p_payload: { task_ids: queue.rows.map((row) => row.id) } });
    const statuses = statusResult.error ? null : acceptanceStatusSchema.safeParse(statusResult.data);
    if (statuses?.success) acceptance = Object.fromEntries(statuses.data.map((row) => [row.task_id, row]));
  }
  // UPGRADE_EOS feature 71: turnaround chips for the same rows.
  let turnaround: Record<string, TurnaroundStatus> = {};
  if (queue?.rows.length) {
    const tatResult = await supabase.rpc("turnaround_command", { p_command: "task.status", p_payload: { task_ids: queue.rows.map((row) => row.id) } });
    const tat = tatResult.error ? null : turnaroundStatusSchema.safeParse(tatResult.data);
    if (tat?.success) turnaround = Object.fromEntries(tat.data.map((row) => [row.task_id, row]));
  }
  const { today } = getBusinessDateBoundaries();
  const myTeams = teamsForRole(context.role);
  const href = (next: { team?: string; status?: string; page?: number }) => {
    const query = new URLSearchParams({ status: next.status ?? status, page: String(next.page ?? 1) });
    const nextTeam = next.team === undefined ? team : next.team;
    if (nextTeam) query.set("team", nextTeam);
    return `/tasks/handoffs?${query.toString()}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Department Handoffs"
        description={`Work created automatically when QC releases material, finishing is received or packaging is completed. ${myTeams.length ? `You take work for: ${myTeams.map((t) => HANDOFF_TEAMS[t]).join(", ")}.` : "You can view every team's queue."}`}
        actions={<Link href="/tasks" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">All tasks</Link>}
      />
      <nav className="flex flex-wrap gap-2" aria-label="Team">
        <Link href={href({ team: "" })} className={`rounded-xl border px-3 py-1.5 text-sm font-bold ${!team ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"}`}>All my teams</Link>
        {Object.entries(HANDOFF_TEAMS).map(([value, text]) => (
          <Link key={value} href={href({ team: value })} className={`rounded-xl border px-3 py-1.5 text-sm font-bold ${team === value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"}`}>{text}</Link>
        ))}
      </nav>
      <nav className="flex flex-wrap gap-2" aria-label="Status">
        {Object.entries(statuses).map(([value, text]) => (
          <Link key={value} href={href({ status: value })} className={`rounded-xl border px-3 py-1 text-xs font-bold ${status === value ? "border-slate-700 bg-slate-700 text-white" : "border-slate-200 bg-white text-slate-600"}`}>{text}</Link>
        ))}
      </nav>
      {!queue ? (
        <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
          {unavailable ? "Department handoffs are not available on this database yet. The database upgrade must be applied first." : "The handoff queue could not be loaded. Refresh to retry."}
        </p>
      ) : !queue.rows.length ? (
        <EmptyState title="No handoffs here" description="New work appears automatically when the previous department confirms its step." />
      ) : <HandoffQueueList queue={queue} today={today} acceptance={acceptance} canAct={context.role !== "viewer"} turnaround={turnaround} />}
      {queue && totalPages > 1 ? (
        <nav className="flex items-center justify-between text-sm font-bold" aria-label="Pages">
          {page > 1 ? <Link href={href({ page: page - 1 })} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Previous</Link> : <span />}
          <span className="text-slate-500">Page {page} of {totalPages} · {queue.total_count} handoffs</span>
          {page < totalPages ? <Link href={href({ page: page + 1 })} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Next</Link> : <span />}
        </nav>
      ) : null}
      {canReprocessHandoffs(context.role) ? <ReprocessHandoff /> : null}
    </div>
  );
}
