import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { RunEscalations, TargetEditor } from "@/components/modules/tasks/turnaround";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/format";
import { canManageTargets, escalationListSchema, formatMinutes, targetsSchema, taskKindLabel } from "@/lib/workflow/turnaround";

// UPGRADE_EOS feature 71: agreed turnaround targets and the work currently escalated.
export default async function TurnaroundPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !can(context.role, "read", "tasks")) redirect("/tasks");
  const params = await searchParams;
  const page = Math.min(Math.max(Number.parseInt(params.page ?? "1", 10) || 1, 1), 100000);
  const supabase = await createClient();
  const [targetsResult, escalationsResult] = await Promise.all([
    supabase.rpc("turnaround_command", { p_command: "targets.list", p_payload: {} }),
    supabase.rpc("turnaround_command", { p_command: "escalations.list", p_payload: { page } })
  ]);
  const unavailable = Boolean(targetsResult.error && ["PGRST202", "42883", "42P01"].includes(targetsResult.error.code ?? ""));
  const targets = targetsResult.error ? null : targetsSchema.safeParse(targetsResult.data);
  const escalations = escalationsResult.error ? null : escalationListSchema.safeParse(escalationsResult.data);
  const manager = canManageTargets(context.role);
  const list = escalations?.success ? escalations.data : null;
  const totalPages = list ? Math.max(1, Math.ceil(list.total_count / 10)) : 1;

  if (!targets?.success) {
    return (
      <div className="space-y-5">
        <PageHeader title="Turnaround Targets" description="Agreed start and completion times for each kind of work, and escalations when they are missed." />
        <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{unavailable ? "Turnaround targets are not available on this database yet. The database upgrade must be applied first." : "Targets could not be loaded. Refresh to retry."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Turnaround Targets" description="Agreed start and completion times for each kind of work, the working time they run on, and who is alerted when they are missed. Recorded waiting pauses the target clock only."
        actions={<Link href="/tasks" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">All tasks</Link>} />
      <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-slate-50 text-xs font-black uppercase tracking-[0.08em] text-slate-500">
            <tr><th className="px-4 py-3">Work</th><th className="px-4 py-3">Start within</th><th className="px-4 py-3">Complete within</th><th className="px-4 py-3">Working time</th><th className="px-4 py-3">Escalates to</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {targets.data.map((target) => (
              <tr key={target.task_kind} className={target.is_active ? "" : "text-slate-400"}>
                <td className="px-4 py-3 font-bold">{taskKindLabel(target.task_kind)}{target.is_active ? "" : " (inactive)"}</td>
                <td className="px-4 py-3">{target.response_minutes === null ? "-" : formatMinutes(target.response_minutes)}</td>
                <td className="px-4 py-3">{formatMinutes(target.completion_minutes)}</td>
                <td className="px-4 py-3">{target.calendar === "24x7" ? "Round the clock" : "Mon–Sat 08:00–20:00"}</td>
                <td className="px-4 py-3">{target.escalation_role.replace(/_/g, " ")}</td>
              </tr>
            ))}
            {!targets.data.length ? <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">No targets agreed yet.</td></tr> : null}
          </tbody>
        </table>
      </section>
      {manager ? <TargetEditor existing={targets.data} /> : null}

      <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-slate-900">Open escalations{list ? ` (${list.total_count})` : ""}</h2>
          {manager ? <RunEscalations /> : null}
        </div>
        {!list ? <p className="text-sm text-slate-500">Escalations could not be loaded.</p> : list.rows.length ? (
          <ul className="divide-y divide-slate-100 text-sm">
            {list.rows.map((row) => (
              <li key={row.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span><Link href={`/tasks/${row.task_id}`} className="font-bold underline-offset-2 hover:underline">{row.title}</Link> · {row.level === 1 ? "not started in time" : "not completed in time"} · {row.assigned_to_name ?? "unassigned"}</span>
                <span className="text-xs text-slate-500">to {row.escalation_role.replace(/_/g, " ")} · {formatDate(row.escalated_at)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-500">Nothing is escalated.</p>}
        {list && totalPages > 1 ? (
          <div className="flex justify-between text-xs font-bold">
            {page > 1 ? <Link href={`/tasks/turnaround?page=${page - 1}`} className="underline">Newer</Link> : <span />}
            {page < totalPages ? <Link href={`/tasks/turnaround?page=${page + 1}`} className="underline">Older</Link> : <span />}
          </div>
        ) : null}
      </section>
    </div>
  );
}
