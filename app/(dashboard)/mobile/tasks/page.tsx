import Link from "next/link";
import { ArrowRight, ListChecks } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/format";

export default async function MobileTasksPage() {
  const context = await getSessionContext();
  const supabase = await createClient();
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, priority, status, due_date, app_users(full_name, email)")
    .eq("company_id", context.companyId)
    .not("status", "eq", "completed")
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(30);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="rounded-3xl bg-slate-950 p-6 text-white"><ListChecks className="h-8 w-8 text-orange" /><h1 className="mt-3 text-2xl font-black">Mobile Tasks</h1><p className="mt-1 text-sm font-medium text-slate-300">Open real operator reminders and supervisor follow-ups.</p></div>
      {tasks?.length ? tasks.map((task: any) => (
        <Link href={`/tasks/${task.id}`} key={task.id} className="block rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition active:scale-[0.99]">
          <div className="flex items-start justify-between gap-3"><div><p className="text-lg font-black text-slate-950">{task.title}</p><p className="mt-1 text-sm font-medium text-slate-500">{task.app_users?.full_name || task.app_users?.email || "Unassigned"} - due {formatDate(task.due_date)}</p></div><span className={`rounded-full px-3 py-1 text-xs font-black capitalize ${statusClass(task.status)}`}>{String(task.status || "open").replace(/_/g, " ")}</span></div>
          <p className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white">Open task workflow <ArrowRight className="h-4 w-4" /></p>
        </Link>
      )) : <EmptyState title="No open tasks" description="Open tasks and reminders appear here when assigned or created for this company." />}
    </div>
  );
}

function statusClass(status: string) {
  if (["completed", "done"].includes(status)) return "bg-emerald-100 text-emerald-800";
  if (["in_progress", "open"].includes(status)) return "bg-blue-100 text-blue-800";
  return "bg-slate-100 text-slate-700";
}
