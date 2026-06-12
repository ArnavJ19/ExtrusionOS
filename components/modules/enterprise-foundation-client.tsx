"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Building2, ClipboardList, Database, Flag, History, ShieldCheck, UserPlus, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
import { createClient } from "@/lib/supabase/browser";
import { branchSchema, dataExchangeJobSchema, featureFlagSchema, notificationSchema, taskSchema, userInvitationSchema, userManagementSchema } from "@/lib/validations/schemas";
import { branchTypes, dataExchangeJobTypes, enterpriseModules, enterpriseTaskPriorities, enterpriseTaskStatuses, labelize, notificationSeverities, type SessionContext, type UserRole } from "@/types/app";
import { formatDate } from "@/lib/utils/format";

const userRoles: UserRole[] = ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "dispatch_manager", "dispatch", "accounts", "quality", "viewer"];
const exchangeModules = ["customers", "aluminium_profiles", "vendors", "inventory_items", "branches"];

type Props = {
  context: SessionContext;
  initialFlags: Record<string, any>[];
  initialBranches: Record<string, any>[];
  plans: Record<string, any>[];
  subscriptions: Record<string, any>[];
  initialNotifications: Record<string, any>[];
  initialTasks: Record<string, any>[];
  auditLogs: Record<string, any>[];
  exchangeJobs: Record<string, any>[];
  users: Record<string, any>[];
  invitations: Record<string, any>[];
  queryErrors: string[];
};

export function EnterpriseFoundationClient({ context, initialFlags, initialBranches, plans, subscriptions, initialNotifications, initialTasks, auditLogs, exchangeJobs, users, invitations, queryErrors }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [flags, setFlags] = useState(initialFlags);
  const [branches, setBranches] = useState(initialBranches);
  const [subscriptionRows, setSubscriptionRows] = useState(subscriptions);
  const [notifications, setNotifications] = useState(initialNotifications);
  const [tasks, setTasks] = useState(initialTasks);
  const [exchangeJobRows, setExchangeJobRows] = useState(exchangeJobs);
  const [userRows, setUserRows] = useState(users);
  const [invitationRows, setInvitationRows] = useState(invitations);
  const [saving, setSaving] = useState(false);
  const [branchForm, setBranchForm] = useState({ branch_name: "", branch_type: "factory", address: "", city: "", state: "", pincode: "", phone: "", manager_name: "", is_active: true });
  const [taskForm, setTaskForm] = useState({ task_type: "general", title: "", description: "", priority: "normal", status: "open", assigned_to: "", due_date: "", related_entity_type: "", related_entity_id: "" });
  const [notificationForm, setNotificationForm] = useState({ recipient_user_id: "", notification_type: "system", severity: "info", title: "", body: "", related_entity_type: "", related_entity_id: "", is_read: false });
  const [exchangeForm, setExchangeForm] = useState({ job_type: "export", module_name: "customers", status: "queued", file_url: "", error_message: "" });
  const [csvText, setCsvText] = useState("");
  const [invitationForm, setInvitationForm] = useState({ email: "", full_name: "", role: "viewer", branch_id: "", expires_at: "" });

  const enabledModules = new Set(flags.filter((flag) => flag.is_enabled).map((flag) => flag.module_name));
  const activeSubscription = subscriptionRows[0];
  const [selectedPlanId, setSelectedPlanId] = useState(activeSubscription?.plan_id ?? plans[0]?.id ?? "");
  const input = "form-input";
  const userOptions = userRows.filter((user) => user.is_active).map((user) => ({ value: user.id, label: user.full_name || user.email || user.role }));

  async function toggleModule(moduleName: string) {
    const existing = flags.find((flag) => flag.module_name === moduleName);
    const nextEnabled = !existing?.is_enabled;
    const parsed = featureFlagSchema.safeParse({ module_name: moduleName, is_enabled: nextEnabled, config_json: JSON.stringify(existing?.config_json ?? {}) });
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Invalid module flag");

    setSaving(true);
    const { data, error } = await supabase.from("feature_flags").upsert({
      id: existing?.id,
      company_id: context.companyId,
      module_name: parsed.data.module_name,
      is_enabled: parsed.data.is_enabled,
      config_json: parsed.data.config_json,
      enabled_by: nextEnabled ? context.userId : existing?.enabled_by ?? null,
      enabled_at: nextEnabled ? new Date().toISOString() : existing?.enabled_at ?? null
    }).select().single();
    setSaving(false);
    if (error) return toast.error(error.message);
    setFlags((current) => [...current.filter((flag) => flag.module_name !== moduleName), data].sort((a, b) => String(a.module_name).localeCompare(String(b.module_name))));
    toast.success(`${labelize(moduleName)} ${nextEnabled ? "enabled" : "disabled"}`);
  }

  async function saveSubscription() {
    if (!selectedPlanId) return toast.error("Select a subscription plan");
    setSaving(true);
    const payload = { company_id: context.companyId, plan_id: selectedPlanId, status: "active", billing_cycle: "manual" };
    const result = activeSubscription?.id
      ? await supabase.from("company_subscriptions").update(payload).eq("id", activeSubscription.id).eq("company_id", context.companyId).select("*, subscription_plans(plan_name, plan_type)").single()
      : await supabase.from("company_subscriptions").insert(payload).select("*, subscription_plans(plan_name, plan_type)").single();
    setSaving(false);
    if (result.error) return toast.error(result.error.message);
    setSubscriptionRows((current) => [result.data, ...current.filter((row) => row.id !== result.data.id)]);
    toast.success("Subscription assignment saved");
  }

  async function saveBranch() {
    const parsed = branchSchema.safeParse(branchForm);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Check branch details");
    setSaving(true);
    const { data, error } = await supabase.from("branches").insert({ ...parsed.data, company_id: context.companyId }).select().single();
    setSaving(false);
    if (error) return toast.error(error.message);
    setBranches((current) => [data, ...current]);
    setBranchForm({ branch_name: "", branch_type: "factory", address: "", city: "", state: "", pincode: "", phone: "", manager_name: "", is_active: true });
    toast.success("Branch saved");
  }

  async function updateUser(user: Record<string, any>, patch: Record<string, any>) {
    if (user.id === context.userId) return toast.error("You cannot change your own role or active status.");

    const next = { role: patch.role ?? user.role, branch_id: patch.branch_id ?? user.branch_id ?? "", is_active: patch.is_active ?? user.is_active };
    const parsed = userManagementSchema.safeParse(next);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Check user settings");

    const payload: Record<string, any> = {
      role: parsed.data.role,
      branch_id: parsed.data.branch_id || null,
      is_active: parsed.data.is_active
    };
    if (parsed.data.role !== user.role) {
      payload.role_changed_by = context.userId;
      payload.role_changed_at = new Date().toISOString();
    }
    if (!parsed.data.is_active && user.is_active) {
      payload.deactivated_by = context.userId;
      payload.deactivated_at = new Date().toISOString();
    }
    if (parsed.data.is_active && !user.is_active) {
      payload.deactivated_by = null;
      payload.deactivated_at = null;
    }

    setSaving(true);
    const { data, error } = await supabase.from("app_users").update(payload).eq("id", user.id).eq("company_id", context.companyId).select("id, full_name, email, role, is_active, branch_id").single();
    setSaving(false);
    if (error) return toast.error(error.message);
    setUserRows((current) => current.map((row) => row.id === user.id ? data : row));
    toast.success("User updated");
  }

  async function createInvitation() {
    const parsed = userInvitationSchema.safeParse(invitationForm);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Check invitation details");
    const expiresAt = parsed.data.expires_at || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    setSaving(true);
    const { data, error } = await supabase.from("user_invitations").insert({
      company_id: context.companyId,
      email: parsed.data.email ?? "",
      full_name: parsed.data.full_name,
      role: parsed.data.role,
      branch_id: parsed.data.branch_id || null,
      expires_at: expiresAt,
      invited_by: context.userId
    }).select().single();
    setSaving(false);
    if (error) return toast.error(error.message);
    setInvitationRows((current) => [data, ...current]);
    setInvitationForm({ email: "", full_name: "", role: "viewer", branch_id: "", expires_at: "" });
    toast.success("Invitation recorded. Send the signup link manually until email invites are configured.");
  }

  async function saveTask() {
    const parsed = taskSchema.safeParse(taskForm);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Check task details");
    setSaving(true);
    const { data, error } = await supabase.from("tasks").insert({ ...parsed.data, company_id: context.companyId, created_by: context.userId }).select().single();
    setSaving(false);
    if (error) return toast.error(error.message);
    setTasks((current) => [data, ...current]);
    setTaskForm({ task_type: "general", title: "", description: "", priority: "normal", status: "open", assigned_to: "", due_date: "", related_entity_type: "", related_entity_id: "" });
    toast.success("Task created");
  }

  async function saveNotification() {
    const parsed = notificationSchema.safeParse(notificationForm);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Check notification details");
    setSaving(true);
    const { data, error } = await supabase.from("notifications").insert({ ...parsed.data, company_id: context.companyId, created_by: context.userId }).select().single();
    setSaving(false);
    if (error) return toast.error(error.message);
    setNotifications((current) => [data, ...current]);
    setNotificationForm({ recipient_user_id: "", notification_type: "system", severity: "info", title: "", body: "", related_entity_type: "", related_entity_id: "", is_read: false });
    toast.success("Notification queued");
  }

  async function saveExchangeJob() {
    const parsed = dataExchangeJobSchema.safeParse(exchangeForm);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Check import/export details");
    setSaving(true);
    const response = await fetch("/api/enterprise/data-exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...parsed.data, csv: csvText })
    });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) return toast.error(result.error ?? "Data exchange failed");
    if (result.job) setExchangeJobRows((current) => [result.job, ...current]);
    if (result.csv) {
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename ?? `${parsed.data.module_name}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    }
    toast.success(result.message ?? "Data exchange completed");
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Enterprise Foundation" description="Control modules, plants, subscriptions, users, alerts, tasks, audit logs, and data exchange readiness." actions={<span className="inline-flex items-center rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-emerald-700">Section-by-section saves</span>} />
      <QueryErrorNotice messages={queryErrors} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="metric-card"><ShieldCheck className="relative z-[1] h-5 w-5 text-orange" /><p className="relative z-[1] mt-3 text-xs font-black uppercase tracking-[0.14em] text-slate-500">Plan</p><p className="relative z-[1] mt-2 text-2xl font-black text-slate-950">{activeSubscription?.subscription_plans?.plan_name ?? "Not assigned"}</p></div>
        <div className="metric-card"><Flag className="relative z-[1] h-5 w-5 text-orange" /><p className="relative z-[1] mt-3 text-xs font-black uppercase tracking-[0.14em] text-slate-500">Enabled Modules</p><p className="relative z-[1] mt-2 text-2xl font-black text-slate-950">{enabledModules.size}/{enterpriseModules.length}</p></div>
        <div className="metric-card"><Building2 className="relative z-[1] h-5 w-5 text-orange" /><p className="relative z-[1] mt-3 text-xs font-black uppercase tracking-[0.14em] text-slate-500">Branches</p><p className="relative z-[1] mt-2 text-2xl font-black text-slate-950">{branches.length}</p></div>
        <div className="metric-card"><ClipboardList className="relative z-[1] h-5 w-5 text-orange" /><p className="relative z-[1] mt-3 text-xs font-black uppercase tracking-[0.14em] text-slate-500">Open Tasks</p><p className="relative z-[1] mt-2 text-2xl font-black text-slate-950">{tasks.filter((task) => task.status !== "completed").length}</p></div>
      </div>

      <Card>
        <CardHeader><h2 className="section-title">Enterprise module controls</h2><p className="mt-1 text-sm font-medium text-slate-500">Feature flags now gate sidebar visibility and protected module pages.</p></CardHeader>
        <CardContent><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{enterpriseModules.map((moduleName) => <button key={moduleName} type="button" disabled={saving} onClick={() => toggleModule(moduleName)} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-orange/60 hover:bg-orange/5 disabled:opacity-60"><span><span className="block text-sm font-black text-slate-950">{labelize(moduleName)}</span><span className="mt-1 block text-xs font-medium text-slate-500">Enterprise module flag</span></span><Badge value={enabledModules.has(moduleName) ? "active" : "inactive"} /></button>)}</div></CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card><CardHeader><h2 className="section-title flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-orange" /> Subscription assignment</h2></CardHeader><CardContent className="space-y-3"><select className={input} value={selectedPlanId} onChange={(event) => setSelectedPlanId(event.target.value)}>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.plan_name} - Rs. {Number(plan.monthly_price ?? 0).toLocaleString("en-IN")}/month</option>)}</select><Button disabled={saving || !selectedPlanId} onClick={saveSubscription}>Save subscription</Button><div className="grid gap-3 sm:grid-cols-2">{plans.map((plan) => <div key={plan.id} className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between"><p className="font-black text-slate-950">{plan.plan_name}</p><Badge value={plan.plan_type} /></div><p className="mt-1 text-sm font-bold text-slate-600">Rs. {Number(plan.monthly_price ?? 0).toLocaleString("en-IN")}/month</p></div>)}</div></CardContent></Card>
        <Card><CardHeader><h2 className="section-title flex items-center gap-2"><UserPlus className="h-5 w-5 text-orange" /> Invite users</h2></CardHeader><CardContent className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><input className={input} placeholder="Email" value={invitationForm.email} onChange={(event) => setInvitationForm({ ...invitationForm, email: event.target.value })} /><input className={input} placeholder="Full name" value={invitationForm.full_name} onChange={(event) => setInvitationForm({ ...invitationForm, full_name: event.target.value })} /></div><div className="grid gap-3 sm:grid-cols-2"><select className={input} value={invitationForm.role} onChange={(event) => setInvitationForm({ ...invitationForm, role: event.target.value })}>{userRoles.map((role) => <option key={role} value={role}>{labelize(role)}</option>)}</select><select className={input} value={invitationForm.branch_id} onChange={(event) => setInvitationForm({ ...invitationForm, branch_id: event.target.value })}><option value="">No branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name}</option>)}</select></div><input className={input} type="date" value={invitationForm.expires_at} onChange={(event) => setInvitationForm({ ...invitationForm, expires_at: event.target.value })} /><Button disabled={saving} onClick={createInvitation}>Record invitation</Button><div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm font-medium text-slate-600">Auth email sending needs a server-side invite provider. For now, this records controlled pending invites and admins can send the normal signup link manually.</div>{invitationRows.length ? invitationRows.map((invite) => <div key={invite.id} className="rounded-2xl border border-slate-200 bg-white p-3"><div className="flex items-center justify-between gap-3"><p className="font-black text-slate-950">{invite.email}</p><Badge value={invite.status} /></div><p className="mt-1 text-xs font-medium text-slate-500">{labelize(invite.role)} · expires {formatDate(invite.expires_at)}</p></div>) : <div className="empty-mini">No pending invitations.</div>}</CardContent></Card>
      </div>

      <Card><CardHeader><h2 className="section-title flex items-center gap-2"><Users className="h-5 w-5 text-orange" /> User management</h2></CardHeader><CardContent>{userRows.length ? <div className="overflow-x-auto"><table className="industrial-table min-w-[900px]"><thead><tr><th>User</th><th>Role</th><th>Branch</th><th>Status</th><th>Actions</th></tr></thead><tbody>{userRows.map((user) => <tr key={user.id}><td><p className="font-black text-slate-950">{user.full_name || user.email || "User"}</p><p className="text-xs font-medium text-slate-500">{user.email}</p></td><td><select className={input} value={user.role} disabled={saving || user.id === context.userId} onChange={(event) => updateUser(user, { role: event.target.value })}>{userRoles.map((role) => <option key={role} value={role}>{labelize(role)}</option>)}</select></td><td><select className={input} value={user.branch_id ?? ""} disabled={saving} onChange={(event) => updateUser(user, { branch_id: event.target.value })}><option value="">No branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name}</option>)}</select></td><td><Badge value={user.is_active ? "active" : "inactive"} /></td><td><Button variant="ghost" disabled={saving || user.id === context.userId} onClick={() => updateUser(user, { is_active: !user.is_active })}>{user.is_active ? "Deactivate" : "Reactivate"}</Button></td></tr>)}</tbody></table></div> : <EmptyState title="No users found" description="Users appear after they join this company workspace." />}</CardContent></Card>

      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <Card><CardHeader><h2 className="section-title">Branches, plants and warehouses</h2></CardHeader><CardContent className="space-y-3"><input className={input} placeholder="Branch name" value={branchForm.branch_name} onChange={(event) => setBranchForm({ ...branchForm, branch_name: event.target.value })} /><select className={input} value={branchForm.branch_type} onChange={(event) => setBranchForm({ ...branchForm, branch_type: event.target.value })}>{branchTypes.map((type) => <option key={type} value={type}>{labelize(type)}</option>)}</select><div className="grid gap-3 sm:grid-cols-2"><input className={input} placeholder="City" value={branchForm.city} onChange={(event) => setBranchForm({ ...branchForm, city: event.target.value })} /><input className={input} placeholder="State" value={branchForm.state} onChange={(event) => setBranchForm({ ...branchForm, state: event.target.value })} /></div><input className={input} placeholder="Phone" value={branchForm.phone} onChange={(event) => setBranchForm({ ...branchForm, phone: event.target.value })} /><input className={input} placeholder="Manager name" value={branchForm.manager_name} onChange={(event) => setBranchForm({ ...branchForm, manager_name: event.target.value })} /><textarea className={`${input} min-h-20`} placeholder="Address" value={branchForm.address} onChange={(event) => setBranchForm({ ...branchForm, address: event.target.value })} /><Button disabled={saving} onClick={saveBranch}>Save branch</Button></CardContent></Card>
        <Card><CardContent>{branches.length ? <div className="overflow-x-auto"><table className="industrial-table min-w-[760px]"><thead><tr><th>Branch</th><th>Type</th><th>Location</th><th>Manager</th><th>Status</th></tr></thead><tbody>{branches.map((branch) => <tr key={branch.id}><td className="font-black text-slate-950">{branch.branch_name}</td><td><Badge value={branch.branch_type} /></td><td>{[branch.city, branch.state].filter(Boolean).join(", ") || "-"}</td><td>{branch.manager_name || "-"}</td><td><Badge value={branch.is_active ? "active" : "inactive"} /></td></tr>)}</tbody></table></div> : <EmptyState title="No branches yet" description="Add factory, warehouse, sales office, depot, or head office locations before enabling multi-plant workflows." />}</CardContent></Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card><CardHeader><h2 className="section-title">Notification center</h2></CardHeader><CardContent className="space-y-3"><input className={input} placeholder="Notification title" value={notificationForm.title} onChange={(event) => setNotificationForm({ ...notificationForm, title: event.target.value })} /><div className="grid gap-3 sm:grid-cols-2"><select className={input} value={notificationForm.severity} onChange={(event) => setNotificationForm({ ...notificationForm, severity: event.target.value })}>{notificationSeverities.map((severity) => <option key={severity} value={severity}>{labelize(severity)}</option>)}</select><select className={input} value={notificationForm.recipient_user_id} onChange={(event) => setNotificationForm({ ...notificationForm, recipient_user_id: event.target.value })}><option value="">All users</option>{userOptions.map((user) => <option key={user.value} value={user.value}>{user.label}</option>)}</select></div><textarea className={`${input} min-h-20`} placeholder="Message body" value={notificationForm.body} onChange={(event) => setNotificationForm({ ...notificationForm, body: event.target.value })} /><Button disabled={saving} onClick={saveNotification}>Create notification</Button><div className="space-y-2 pt-2">{notifications.length ? notifications.map((item) => <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-3"><div className="flex items-center justify-between gap-3"><p className="font-black text-slate-950">{item.title}</p><Badge value={item.severity} /></div><p className="mt-1 text-xs font-medium text-slate-500">{item.body || "No detail"}</p></div>) : <div className="empty-mini">No notifications yet.</div>}</div></CardContent></Card>
        <Card><CardHeader><h2 className="section-title">Task and reminder engine</h2></CardHeader><CardContent className="space-y-3"><input className={input} placeholder="Task title" value={taskForm.title} onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })} /><div className="grid gap-3 sm:grid-cols-3"><select className={input} value={taskForm.priority} onChange={(event) => setTaskForm({ ...taskForm, priority: event.target.value })}>{enterpriseTaskPriorities.map((priority) => <option key={priority} value={priority}>{labelize(priority)}</option>)}</select><select className={input} value={taskForm.status} onChange={(event) => setTaskForm({ ...taskForm, status: event.target.value })}>{enterpriseTaskStatuses.map((status) => <option key={status} value={status}>{labelize(status)}</option>)}</select><select className={input} value={taskForm.assigned_to} onChange={(event) => setTaskForm({ ...taskForm, assigned_to: event.target.value })}><option value="">Unassigned</option>{userOptions.map((user) => <option key={user.value} value={user.value}>{user.label}</option>)}</select></div><input className={input} type="date" value={taskForm.due_date} onChange={(event) => setTaskForm({ ...taskForm, due_date: event.target.value })} /><textarea className={`${input} min-h-20`} placeholder="Task description" value={taskForm.description} onChange={(event) => setTaskForm({ ...taskForm, description: event.target.value })} /><Button disabled={saving} onClick={saveTask}>Create task</Button><div className="space-y-2 pt-2">{tasks.length ? tasks.map((task) => <div key={task.id} className="rounded-2xl border border-slate-200 bg-white p-3"><div className="flex items-center justify-between gap-3"><p className="font-black text-slate-950">{task.title}</p><Badge value={task.priority} /></div><p className="mt-1 text-xs font-medium text-slate-500">Due {formatDate(task.due_date)} · {task.app_users?.full_name || "Unassigned"}</p></div>) : <div className="empty-mini">No tasks yet.</div>}</div></CardContent></Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card><CardHeader><h2 className="section-title flex items-center gap-2"><Database className="h-5 w-5 text-orange" /> Import/export center</h2></CardHeader><CardContent className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><select className={input} value={exchangeForm.job_type} onChange={(event) => setExchangeForm({ ...exchangeForm, job_type: event.target.value })}>{dataExchangeJobTypes.map((type) => <option key={type} value={type}>{labelize(type)}</option>)}</select><select className={input} value={exchangeForm.module_name} onChange={(event) => setExchangeForm({ ...exchangeForm, module_name: event.target.value })}>{exchangeModules.map((moduleName) => <option key={moduleName} value={moduleName}>{labelize(moduleName)}</option>)}</select></div>{exchangeForm.job_type === "import" ? <textarea className={`${input} min-h-40 font-mono text-xs`} placeholder="Paste CSV text here. Header row is required." value={csvText} onChange={(event) => setCsvText(event.target.value)} /> : null}<Button disabled={saving} onClick={saveExchangeJob}>{exchangeForm.job_type === "export" ? "Export CSV" : "Import CSV"}</Button><div className="space-y-2 pt-2">{exchangeJobRows.length ? exchangeJobRows.map((job) => <div key={job.id} className="rounded-2xl border border-slate-200 bg-white p-3"><p className="font-black text-slate-950">{labelize(job.module_name)} {labelize(job.job_type)}</p><Badge value={job.status} /></div>) : <div className="empty-mini">No import/export jobs yet.</div>}</div></CardContent></Card>
        <Card><CardHeader><h2 className="section-title flex items-center gap-2"><History className="h-5 w-5 text-orange" /> Audit feed</h2></CardHeader><CardContent className="space-y-2">{auditLogs.length ? auditLogs.map((log) => <div key={log.id} className="rounded-2xl border border-slate-200 bg-white p-3"><p className="font-black text-slate-950">{labelize(log.action)}</p><p className="mt-1 text-xs font-medium text-slate-500">{log.entity_type} · {formatDate(log.created_at)}</p></div>) : <EmptyState title="No audit entries" description="Database audit triggers now record changes to core business tables." />}</CardContent></Card>
      </div>
    </div>
  );
}
