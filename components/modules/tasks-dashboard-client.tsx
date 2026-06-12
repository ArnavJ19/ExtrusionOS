"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { labelize, type SessionContext } from "@/types/app";

type UserOption = { id: string; full_name: string | null; email: string | null; role: string; dealer_id: string | null };
type DealerOption = { id: string; dealer_name: string; dealer_code?: string | null };
type TaskRow = { id: string; title: string; description?: string | null; priority: string; status: string; due_date?: string | null; assigned_to?: string | null; created_by?: string | null; dealership_id?: string | null; completed_at?: string | null; assignee?: { full_name?: string | null; email?: string | null } | null; creator?: { full_name?: string | null; email?: string | null } | null; dealers?: { dealer_name?: string | null } | null };

export function TasksDashboardClient({ context, tasks, users, dealers }: { context: SessionContext; tasks: TaskRow[]; users: UserOption[]; dealers: DealerOption[] }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const defaultDealerId = context.dealerId ?? dealers[0]?.id ?? "";
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", assigned_to: "", due_date: today, priority: "normal", dealership_id: defaultDealerId });
  const visibleUsers = context.dealerId ? users.filter((user) => user.dealer_id === context.dealerId) : form.dealership_id ? users.filter((user) => user.dealer_id === form.dealership_id) : users.filter((user) => !user.dealer_id);
  const todayTasks = tasks.filter((task) => task.due_date === today);
  const completedToday = todayTasks.filter((task) => task.status === "completed");
  const assignedToday = todayTasks.length;
  const ownerAssigned = context.dealerId ? tasks.filter((task) => task.dealership_id === context.dealerId && !task.creator?.email?.includes(context.email ?? "__never__") && !["dealer_admin", "dealer_staff"].includes(users.find((user) => user.id === task.created_by)?.role ?? "")) : [];
  const priorityCounts = ["urgent", "high", "normal", "low"].map((priority) => ({ priority, count: tasks.filter((task) => task.priority === priority).length }));
  const peopleStats = visibleUsers.map((user) => ({ user, assigned: tasks.filter((task) => task.assigned_to === user.id).length, completed: tasks.filter((task) => task.assigned_to === user.id && task.status === "completed").length })).filter((row) => row.assigned > 0 || row.completed > 0);

  async function createTask() {
    setSaving(true);
    const response = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const payload = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) return toast.error(payload.error ?? "Could not create task");
    toast.success("Task created");
    setForm({ title: "", description: "", assigned_to: "", due_date: today, priority: "normal", dealership_id: defaultDealerId });
    router.refresh();
  }

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
          <CardContent className="space-y-4">
            {!context.dealerId ? <label className="block space-y-1.5"><span className="form-label">Dealership / Factory</span><select className="form-input" value={form.dealership_id} onChange={(event) => setForm({ ...form, dealership_id: event.target.value, assigned_to: "" })}><option value="">Factory task</option>{dealers.map((dealer) => <option key={dealer.id} value={dealer.id}>{dealer.dealer_name}</option>)}</select></label> : null}
            <label className="block space-y-1.5"><span className="form-label">Title *</span><input className="form-input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Call customer, collect payment, prepare site measurement" /></label>
            <label className="block space-y-1.5"><span className="form-label">Assign To</span><select className="form-input" value={form.assigned_to} onChange={(event) => setForm({ ...form, assigned_to: event.target.value })}><option value="">Unassigned</option>{visibleUsers.map((user) => <option key={user.id} value={user.id}>{user.full_name || user.email || user.id}</option>)}</select></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5"><span className="form-label">Due Date</span><input className="form-input" type="date" value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} /></label>
              <label className="block space-y-1.5"><span className="form-label">Priority</span><select className="form-input" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
            </div>
            <label className="block space-y-1.5"><span className="form-label">Description</span><textarea className="form-input min-h-24" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
            <Button type="button" disabled={saving} onClick={createTask}>{saving ? "Creating..." : "Create Task"}</Button>
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
