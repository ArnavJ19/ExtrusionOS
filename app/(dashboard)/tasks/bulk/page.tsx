import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { BulkQueue } from "@/components/modules/operations/bulk-queue";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { formatDate } from "@/lib/utils/format";
import { canAssignTo, canBulkTasks } from "@/lib/workflow/bulk-queue";

const PAGE_SIZES = [10, 25, 50] as const;

// UPGRADE_EOS feature 13: reassign, reschedule or reprioritise several open tasks at once.
export default async function BulkTasksPage({ searchParams }: { searchParams: Promise<{ page?: string; size?: string; filter?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !canBulkTasks(context.role)) redirect("/tasks");
  const params = await searchParams;
  const size = PAGE_SIZES.find((value) => String(value) === params.size) ?? 10;
  const page = Math.min(Math.max(Number.parseInt(params.page ?? "1", 10) || 1, 1), 100000);
  const filter = params.filter === "unassigned" || params.filter === "overdue" ? params.filter : "all";
  const { today } = getBusinessDateBoundaries();
  const supabase = await createClient();
  let query = supabase.from("tasks").select("id, title, status, priority, due_date, assigned_to, handoff_team", { count: "exact" })
    .eq("company_id", context.companyId).is("dealership_id", null).in("status", ["open", "in_progress"])
    .order("due_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true }).range((page - 1) * size, page * size - 1);
  if (filter === "unassigned") query = query.is("assigned_to", null);
  if (filter === "overdue") query = query.lt("due_date", today);
  const [tasksResult, usersResult] = await Promise.all([
    query,
    supabase.from("app_users").select("id, full_name, role").eq("company_id", context.companyId).eq("is_active", true).is("dealer_id", null).order("full_name").limit(1000)
  ]);
  if (tasksResult.error || usersResult.error) throw new Error("Tasks could not be loaded. Refresh to retry.");
  const users = usersResult.data ?? [];
  const names = new Map(users.map((user) => [user.id, user.full_name || "Employee"]));
  const employees = users.filter((user) => canAssignTo(context.role, user.role)).map((user) => ({ value: user.id, label: `${user.full_name || "Employee"} · ${user.role.replace(/_/g, " ")}` }));
  const rows = (tasksResult.data ?? []).map((task) => ({
    id: task.id, label: task.title, href: `/tasks/${task.id}`,
    detail: [task.status.replace(/_/g, " "), task.priority, task.due_date ? `due ${formatDate(task.due_date)}` : "no due date", task.assigned_to ? names.get(task.assigned_to) ?? "assigned" : "unassigned", task.handoff_team ? `${task.handoff_team} handoff` : null].filter(Boolean).join(" · ")
  }));
  const total = tasksResult.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const href = (next: { page?: number; size?: number; filter?: string }) => `/tasks/bulk?${new URLSearchParams({ page: String(next.page ?? 1), size: String(next.size ?? size), filter: next.filter ?? filter }).toString()}`;

  return (
    <div className="space-y-5">
      <PageHeader title="Bulk Task Updates" description="Select open tasks, preview what will happen to each, then apply. Tasks outside the teams you supervise, dealer tasks and closed tasks are reported, never silently skipped."
        actions={<Link href="/tasks" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">All tasks</Link>} />
      <nav className="flex flex-wrap items-center gap-2 text-sm font-bold">
        {[["all", "All open"], ["unassigned", "Unassigned"], ["overdue", "Overdue"]].map(([value, text]) => (
          <Link key={value} href={href({ filter: value })} className={`rounded-xl border px-3 py-1.5 ${filter === value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"}`}>{text}</Link>
        ))}
        <span className="ml-auto text-xs text-slate-500">Rows per page:</span>
        {PAGE_SIZES.map((value) => <Link key={value} href={href({ size: value })} className={`rounded-lg border px-2 py-1 text-xs ${size === value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white"}`}>{value}</Link>)}
      </nav>
      {!rows.length ? <EmptyState title="No open tasks here" description="Try another filter." /> : (
        <BulkQueue target="tasks" rows={rows} employees={employees} actions={[
          { action: "assign", label: "Assign to", input: "employee" }, { action: "due_date", label: "Set due date", input: "date" }, { action: "priority", label: "Set priority", input: "priority" }
        ]} />
      )}
      {totalPages > 1 ? (
        <nav className="flex items-center justify-between text-sm font-bold" aria-label="Pages">
          {page > 1 ? <Link href={href({ page: page - 1 })} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Previous</Link> : <span />}
          <span className="text-slate-500">Page {page} of {totalPages} · {total} tasks</span>
          {page < totalPages ? <Link href={href({ page: page + 1 })} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Next</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
