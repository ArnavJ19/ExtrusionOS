"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import type { SessionContext } from "@/types/app";

export type TaskUserOption = { id: string; full_name: string | null; email: string | null; role: string; dealer_id: string | null };
export type TaskDealerOption = { id: string; dealer_name: string; dealer_code?: string | null };

export function TaskCreateForm({ context, users, dealers, redirectTo }: { context: SessionContext; users: TaskUserOption[]; dealers: TaskDealerOption[]; redirectTo?: string }) {
  const router = useRouter();
  const { today } = getBusinessDateBoundaries();
  const defaultDealerId = context.dealerId ?? dealers[0]?.id ?? "";
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", assigned_to: "", due_date: today, priority: "normal", dealership_id: defaultDealerId });
  const visibleUsers = context.dealerId ? users.filter((user) => user.dealer_id === context.dealerId) : form.dealership_id ? users.filter((user) => user.dealer_id === form.dealership_id) : users.filter((user) => !user.dealer_id);

  async function createTask() {
    setSaving(true);
    const response = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const payload = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) return toast.error(payload.error ?? "Could not create task");
    toast.success("Task created");
    if (redirectTo) {
      router.push(redirectTo);
      router.refresh();
      return;
    }
    setForm({ title: "", description: "", assigned_to: "", due_date: today, priority: "normal", dealership_id: defaultDealerId });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {!context.dealerId ? <label className="block space-y-1.5"><span className="form-label">Dealership / Factory</span><select className="form-input" value={form.dealership_id} onChange={(event) => setForm({ ...form, dealership_id: event.target.value, assigned_to: "" })}><option value="">Factory task</option>{dealers.map((dealer) => <option key={dealer.id} value={dealer.id}>{dealer.dealer_name}</option>)}</select></label> : null}
      <label className="block space-y-1.5"><span className="form-label">Title *</span><input className="form-input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Call customer, collect payment, prepare site measurement" /></label>
      <label className="block space-y-1.5"><span className="form-label">Assign To</span><select className="form-input" value={form.assigned_to} onChange={(event) => setForm({ ...form, assigned_to: event.target.value })}><option value="">Unassigned</option>{visibleUsers.map((user) => <option key={user.id} value={user.id}>{user.full_name || user.email || user.id}</option>)}</select></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5"><span className="form-label">Due Date</span><input className="form-input" type="date" value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} /></label>
        <label className="block space-y-1.5"><span className="form-label">Priority</span><select className="form-input" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
      </div>
      <label className="block space-y-1.5"><span className="form-label">Description</span><textarea className="form-input min-h-24" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
      <Button type="button" disabled={saving || !form.title.trim()} onClick={createTask}>{saving ? "Creating..." : "Create Task"}</Button>
    </div>
  );
}
