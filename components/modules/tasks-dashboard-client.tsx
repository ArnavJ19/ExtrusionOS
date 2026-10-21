"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { TaskCreateForm, type TaskDealerOption as DealerOption, type TaskUserOption as UserOption } from "@/components/modules/task-create-form";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { labelize, type SessionContext } from "@/types/app";
type TaskRow = { id: string; title: string; description?: string | null; priority: string; status: string; due_date?: string | null; assigned_to?: string | null; created_by?: string | null; dealership_id?: string | null; completed_at?: string | null; assignee?: { full_name?: string | null; email?: string | null } | null; creator?: { full_name?: string | null; email?: string | null } | null; dealers?: { dealer_name?: string | null } | null };

export function TasksDashboardClient({ context, tasks, users, dealers }: { context: SessionContext; tasks: TaskRow[]; users: UserOption[]; dealers: DealerOption[] }) {
  const router = useRouter();
  const { today } = getBusinessDateBoundaries();
  const visibleUsers = context.dealerId ? users.filter((user) => user.dealer_id === context.dealerId) : users;
  const todayTasks = tasks.filter((task) => task.due_date === today);
  const completedToday = todayTasks.filter((task) => task.status === "completed");
  const assignedToday = todayTasks.length;
  const ownerAssigned = context.dealerId ? tasks.filter((task) => task.dealership_id === context.dealerId && !task.creator?.email?.includes(context.email ?? "__never__") && !["dealer_admin", "dealer_staff"].includes(users.find((user) => user.id === task.created_by)?.role ?? "")) : [];
  const priorityCounts = ["urgent", "high", "normal", "low"].map((priority) => ({ priority, count: tasks.filter((task) => task.priority === priority).length }));
  const peopleStats = visibleUsers.map((user) => ({ user, assigned: tasks.filter((task) => task.assigned_to === user.id).length, completed: tasks.filter((task) => task.assigned_to === user.id && task.status === "completed").length })).filter((row) => row.assigned > 0 || row.completed > 0);

  async function updateStatus(id: string, status: string) {
    const response = await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return toast.error(payload.error ?? "Could not update task");
    toast.success("Task updated");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Assigned Today" value={String(assignedToday)} />
        <Metric label="Completed Today" value={String(completedToday.length)} />
        <Metric label="Open Tasks" value={String(tasks.filter((task) => task.status !== "completed" && task.status !== "cancelled").length)} />
        <Metric label="Owner Assigned" value={String(ownerAssigned.length)} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader><h2 className="section-title">Create Task</h2></CardHeader>
          <CardContent>
            <TaskCreateForm context={context} users={users} dealers={dealers} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h2 className="section-title">Task Analytics</h2></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 p-4"><p className="font-black text-slate-950">Priority Mix</p><div className="mt-3 space-y-2">{priorityCounts.map((row) => <div key={row.priority} className="flex justify-between text-sm font-semibold"><span>{labelize(row.priority)}</span><span>{row.count}</span></div>)}</div></div>
            <div className="rounded-2xl border border-slate-200 p-4"><p className="font-black text-slate-950">Employee Completion</p><div className="mt-3 space-y-2">{peopleStats.map((row) => <div key={row.user.id} className="flex justify-between gap-3 text-sm font-semibold"><span className="truncate">{row.user.full_name || row.user.email}</span><span>{row.completed}/{row.assigned}</span></div>)}{!peopleStats.length ? <p className="text-sm font-semibold text-slate-500">No assigned tasks yet.</p> : null}</div></div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><h2 className="section-title">Task Board</h2></CardHeader>
        <CardContent><div className="overflow-x-auto"><table className="industrial-table min-w-[1000px]"><thead><tr>{["Task", "Assignee", "Dealer", "Due", "Priority", "Status", "Action"].map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{tasks.map((task) => <tr key={task.id}><td className="font-black text-slate-950">{task.title}<p className="text-xs font-semibold text-slate-500">{task.description ?? ""}</p></td><td>{task.assignee?.full_name || task.assignee?.email || "Unassigned"}</td><td>{task.dealers?.dealer_name ?? "Factory"}</td><td>{task.due_date ?? "-"}</td><td><Badge value={task.priority} /></td><td><Badge value={task.status} /></td><td><select className="form-input min-w-36" value={task.status} onChange={(event) => updateStatus(task.id, event.target.value)}><option value="open">Open</option><option value="in_progress">In Progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></td></tr>)}{!tasks.length ? <tr><td colSpan={7} className="px-4 py-12 text-center font-semibold text-slate-500">No tasks found.</td></tr> : null}</tbody></table></div></CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <Card><CardContent><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</p><p className="mt-2 text-2xl font-black text-slate-950">{value}</p></CardContent></Card>;
}
