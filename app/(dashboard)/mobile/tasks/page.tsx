import Link from "next/link";
import { ArrowRight, ListChecks } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/format";
import { canAccessMobileDestination } from "@/lib/auth/role-experience";
import { redirect } from "next/navigation";
import { MobilePagination } from "@/components/ui/mobile-pagination";

export default async function MobileTasksPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const context = await getSessionContext();
  if (!canAccessMobileDestination(context.role, "tasks")) redirect("/dashboard?denied=1");
  const supabase = await createClient();
  const page = Math.max(1, Number((await searchParams).page ?? 1) || 1);
  const pageSize = 30;
  const { data: tasks, error, count } = await supabase
    .from("tasks")
    .select("id, title, priority, status, due_date, app_users(full_name, email)", { count: "exact" })
    .eq("company_id", context.companyId)
    .not("status", "eq", "completed")
    .or(`assigned_to.eq.${context.userId},assigned_to.is.null`)
    .order("due_date", { ascending: true, nullsFirst: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) return <div className="mx-auto max-w-xl space-y-4"><div className="rounded-3xl bg-slate-950 p-6 text-white"><ListChecks className="h-8 w-8 text-orange" /><h1 className="mt-3 text-2xl font-black">Mobile Tasks</h1><p className="mt-1 text-sm font-medium text-slate-300">Open real operator reminders and supervisor follow-ups.</p></div><ErrorState description="Could not load assigned mobile tasks. Refresh and try again before assuming the queue is empty." /></div>;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="rounded-3xl bg-slate-950 p-6 text-white"><ListChecks className="h-8 w-8 text-orange" /><h1 className="mt-3 text-2xl font-black">Mobile Tasks</h1><p className="mt-1 text-sm font-medium text-slate-300">Open real operator reminders and supervisor follow-ups.</p></div>
      {tasks?.length ? tasks.map((task: any) => (
        <Link href={`/tasks/${task.id}`} key={task.id} className="block rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition active:scale-[0.99]">
          <div className="flex items-start justify-between gap-3"><div><p className="text-lg font-black text-slate-950">{task.title}</p><p className="mt-1 text-sm font-medium text-slate-500">{task.app_users?.full_name || task.app_users?.email || "Unassigned"} - due {formatDate(task.due_date)}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black capitalize ${statusClass(task.status)}`}>{String(task.status || "open").replace(/_/g, " ")}</span></div>
          <p className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white">Open task workflow <ArrowRight className="h-4 w-4" /></p>
        </Link>
      )) : <EmptyState title="No assigned tasks" description="Tasks assigned to you and unassigned factory-wide reminders appear here." />}
      <MobilePagination path="/mobile/tasks" page={page} pageSize={pageSize} totalCount={count ?? 0} />
    </div>
  );
}

function statusClass(status: string) {
  if (["completed", "done"].includes(status)) return "bg-emerald-100 text-emerald-800";
  if (["in_progress", "open"].includes(status)) return "bg-blue-100 text-blue-800";
  return "bg-slate-100 text-slate-700";
}
