"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/utils/format";

type SecurityCenterClientProps = {
  loginEvents: Record<string, any>[];
  sensitiveActions: Record<string, any>[];
  auditLogs: Record<string, any>[];
  roleChanges: Record<string, any>[];
  userSessions: Record<string, any>[];
};

const tabs = ["logins", "sensitive", "audit", "roles", "users"] as const;
type Tab = typeof tabs[number];

export function SecurityCenterClient({ loginEvents, sensitiveActions, auditLogs, roleChanges, userSessions }: SecurityCenterClientProps) {
  const [activeTab, setActiveTab] = useState<Tab>("logins");
  const failedLogins = loginEvents.filter((event) => event.event_type === "login_failed").length;
  const inactiveUsers = userSessions.filter((user) => user.is_active === false).length;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Login Events" value={String(loginEvents.length)} />
        <Metric label="Failed Logins" value={String(failedLogins)} />
        <Metric label="Sensitive Actions" value={String(sensitiveActions.length)} />
        <Metric label="Inactive Users" value={String(inactiveUsers)} highlight />
      </div>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`rounded-xl px-3 py-2 text-xs font-black uppercase tracking-[0.12em] transition ${activeTab === tab ? "bg-charcoal text-white" : "border border-slate-200 bg-white text-slate-600 hover:border-orange hover:text-orange"}`}>{tab}</button>)}
          </div>
        </CardHeader>
        <CardContent>
          {activeTab === "logins" ? <EventTable rows={loginEvents} columns={["User", "Status", "IP", "Created"]} render={(row) => [userLabel(row), <Badge key="status" value={row.event_type ?? row.status ?? "login"} />, row.ip_address ?? "-", formatDate(row.created_at)]} /> : null}
          {activeTab === "sensitive" ? <EventTable rows={sensitiveActions} columns={["User", "Action", "Resource", "Created"]} render={(row) => [userLabel(row), <Badge key="action" value={row.action_type ?? row.action ?? "action"} />, row.entity_type ?? row.resource_type ?? "-", formatDate(row.created_at)]} /> : null}
          {activeTab === "audit" ? <EventTable rows={auditLogs} columns={["Action", "Entity", "Record", "Created"]} render={(row) => [<Badge key="action" value={row.action ?? "audit"} />, row.entity_type ?? row.table_name ?? "-", row.entity_id ?? row.record_id ?? "-", formatDate(row.created_at)]} /> : null}
          {activeTab === "roles" ? <EventTable rows={roleChanges} columns={["Action", "User", "Record", "Created"]} render={(row) => [<Badge key="action" value={row.action ?? "role_change"} />, userLabel(row), row.entity_id ?? row.record_id ?? "-", formatDate(row.created_at)]} /> : null}
          {activeTab === "users" ? <EventTable rows={userSessions} columns={["User", "Role", "Status", "Updated"]} render={(row) => [userLabel(row), <Badge key="role" value={row.role ?? "viewer"} />, <Badge key="status" value={row.is_active === false ? "inactive" : "active"} />, formatDate(row.updated_at ?? row.created_at)]} /> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function userLabel(row: Record<string, any>) {
  const user = row.app_user ?? row.app_users ?? row;
  return user.full_name || user.email || row.user_email || row.actor_email || "System";
}

function EventTable({ rows, columns, render }: { rows: Record<string, any>[]; columns: string[]; render: (row: Record<string, any>) => ReactNode[] }) {
  return <div className="overflow-x-auto"><table className="industrial-table min-w-[760px]"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id ?? index}>{render(row).map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}{!rows.length ? <tr><td colSpan={columns.length} className="px-4 py-12 text-center font-semibold text-slate-500">No records found for this security view.</td></tr> : null}</tbody></table></div>;
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return <Card className={highlight ? "border-orange/40" : undefined}><CardContent><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{label}</p><p className={`mt-2 text-2xl font-black ${highlight ? "text-orange" : "text-slate-950"}`}>{value}</p></CardContent></Card>;
}
