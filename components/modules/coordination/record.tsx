"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { CoordinationMutationForm, ACTION_FORMS } from "./mutation-form";
import { canUseCoordinationAction, type CoordinationAction, type CoordinationDetail, type CoordinationRow, type CoordinationView } from "@/lib/workflow/coordination";
import type { SessionContext } from "@/types/app";
import { formatDate } from "@/lib/utils/format";

const TITLES: Record<string, string> = {
  amount: "Promised amount (INR)", balance_due: "Current invoice balance (INR)", original_due_date: "Original promise date", net_receipts_since_promise: "Net cash-receipt change since promise (INR)", non_cash_adjustment_change: "Non-cash adjustment change since promise (INR)",
  credit_change_since_promise: "Credit-note change since promise (INR)", remaining_promise: "Unfulfilled net-receipt promise (INR)", disputed_amount: "Recorded disputed amount (INR)",
  priority: "Operational priority", policy: "Priority policy", proposed_name: "Proposed coordinator", coordinator_active: "Current coordinator active", proposed_active: "Proposed coordinator active", resource_conflicts: "Other orders sharing a machine and planned date",
  response_hours: "Response target (elapsed hours)", requirements: "Receiving prerequisites", evidence: "Source evidence", clock_basis: "Response clock", team: "Receiving team", revision: "Revision",
  starts_at: "Coverage starts", ends_at: "Coverage ends", acknowledged_at: "Acknowledged", cancelled_at: "Ended early", open_primary_tasks: "Open tasks still with primary", moved_tasks: "Tasks moved under delegation", excluded_primary_tasks: "Open primary tasks excluded by team eligibility",
  criteria: "Request completion criteria", last_note: "Latest response", resolution: "Resolution", resolution_note: "Recorded closure explanation", resolved_at: "Resolved at", reminder_count: "Reminders already recorded", reminder_hours: "Reminder interval (hours)",
  backup_name: "Backup steward", previous_weight: "Originally reviewed section weight (kg/m)", proposed_weight: "Proposed section weight (kg/m)", current_weight: "Current master section weight (kg/m)", reviewed_at: "Reviewed at", state: "Recorded correction state", owner_active: "Task owner active", started_at: "Session captured at", order_number: "Order"
};

function readable(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString("en-IN", { maximumFractionDigits: 3 });
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return `${new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`;
  return String(value).replaceAll("_", " ");
}

function SessionSnapshot({ row }: { row: CoordinationRow }) {
  const snapshot = row.details.snapshot as { as_of?: string; scope?: string; orders?: { state: string; rows: Array<{ id: string; label: string; status: string; coordinator: string | null; due_date: string | null }> }; decisions?: { state: string; rows: Array<{ id: string; title: string; owner: string | null; task_id: string }> } } | undefined;
  if (!snapshot) return null;
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
    <h2 className="font-bold">Recorded agenda</h2><p className="text-sm text-slate-700">As of {readable(snapshot.as_of)}. This retained snapshot can differ from the linked current records.</p><p className="text-xs text-slate-600">{snapshot.scope}</p>
    <h3 className="font-semibold">Priority orders</h3>
    {snapshot.orders?.state !== "available" ? <p role="alert">Order source was unavailable at capture. Workload is unknown.</p> : snapshot.orders.rows.length ? <ul className="space-y-2">{snapshot.orders.rows.map(order => <li key={order.id} className="text-sm"><Link className="font-bold underline" href={`/orders/${order.id}`}>{order.label}</Link> · {order.status.replaceAll("_", " ")} · {order.coordinator ?? "Coordinator unassigned"} · due {formatDate(order.due_date)}</li>)}</ul> : <p className="text-sm">No active orders were recorded in this bounded agenda.</p>}
    <h3 className="font-semibold">Unresolved decisions carried forward</h3>
    {snapshot.decisions?.state !== "available" ? <p role="alert">Decision source was unavailable at capture. Outstanding decisions are unknown.</p> : snapshot.decisions.rows.length ? <ul className="space-y-2">{snapshot.decisions.rows.map(decision => <li key={decision.id} className="text-sm"><Link className="font-bold underline" href={`/tasks/${decision.task_id}`}>{decision.title}</Link> · {decision.owner ?? "Owner unavailable"}</li>)}</ul> : <p className="text-sm">No unresolved decisions were recorded.</p>}
  </section>;
}

export function CoordinationRecord({ view, detail, context }: { view: CoordinationView; detail: CoordinationDetail; context: SessionContext }) {
  const { row } = detail;
  const active = !["closed", "cancelled", "withdrawn", "settled", "source_unavailable", "expired", "ended"].includes(row.status);
  const details = row.details;
  const handoffs = Array.isArray(details.handoffs) ? details.handoffs as Array<{ id: string; title: string; acceptance_state: string | null; expected_kg: number; accepted_kg: number | null; response_due_at: string; open_returns: number; status: string }> : [];
  return <div className="space-y-5">
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="break-words text-xl font-bold">{row.label}</h2><Badge value={row.status} /></div>
      <p className="text-sm text-slate-700">{row.summary}</p>
      <p className="text-sm font-semibold">Responsible employee: {row.owner ?? "Unassigned"}{row.due_date ? ` · Due ${formatDate(row.due_date)}` : ""}</p>
      {row.source_href ? <Link href={row.source_href} className="inline-flex min-h-11 items-center text-sm font-bold underline">Open current source workflow</Link> : null}
      <dl className="grid gap-4 sm:grid-cols-2">{Object.entries(details).filter(([key, value]) => TITLES[key] && typeof value !== "object" || TITLES[key] && value === null).map(([key, value]) => <div key={key} className="min-w-0"><dt className="text-xs font-bold text-slate-500">{TITLES[key]}</dt><dd className="break-words text-sm text-slate-900">{readable(value)}</dd></div>)}</dl>
      <p className="text-xs text-slate-500">Current authorized read as of {readable(detail.as_of)}. Review rechecks source state before commitment.</p>
    </section>
    {view === "sessions" ? <SessionSnapshot row={row} /> : null}
    {view === "handoffs" ? <section className="space-y-3 rounded-2xl border border-slate-200 p-4"><h2 className="font-bold">Handoffs using this exact revision</h2><p className="text-xs text-slate-600">Up to ten handoffs. Open the department queue for the full database. Earlier handoffs without a snapshot have no recorded service contract.</p>{handoffs.length ? <ul className="space-y-3">{handoffs.map(handoff => <li className="rounded-xl bg-slate-50 p-3 text-sm" key={handoff.id}><Link href={`/tasks/${handoff.id}`} className="font-bold underline">{handoff.title}</Link><p>{handoff.acceptance_state ?? "Acceptance unavailable"}; expected {readable(handoff.expected_kg)} kg; accepted {readable(handoff.accepted_kg)} kg; {handoff.open_returns} open return(s)</p><p>Response target: {readable(handoff.response_due_at)}</p></li>)}</ul> : <p className="text-sm">No handoff has been created under this contract yet.</p>}</section> : null}
    <div className="space-y-4">
      {view === "orders" && active ? <>
        <ActionDisclosure><CoordinationMutationForm action="coordinator.propose" role={context.role} fixed={{ order_id: row.id }} /></ActionDisclosure>
        {details.proposed_id === context.userId ? <ActionDisclosure open><CoordinationMutationForm action="coordinator.accept" role={context.role} fixed={{ order_id: row.id }} /></ActionDisclosure> : null}
        <ActionDisclosure><CoordinationMutationForm action="priority.set" role={context.role} fixed={{ order_id: row.id }} initial={{ priority: String(details.priority ?? "normal") }} /></ActionDisclosure>
        <ActionDisclosure><CoordinationMutationForm action="request.create" role={context.role} fixed={{ order_id: row.id }} /></ActionDisclosure>
      </> : null}
      {view === "collections" && active ? <><ActionDisclosure><CoordinationMutationForm action="collection.update" role={context.role} fixed={{ id: row.id }} initial={{ due_date: row.due_date ?? "", employee_id: String(details.employee_id ?? ""), disputed_amount: String(details.disputed_amount ?? "0") }} /></ActionDisclosure><ActionDisclosure><CoordinationMutationForm action="collection.withdraw" role={context.role} fixed={{ id: row.id }} /></ActionDisclosure></> : null}
      {view === "coverage" && active ? <>
        {details.backup_id === context.userId && !details.acknowledged_at ? <ActionDisclosure open><CoordinationMutationForm action="coverage.acknowledge" role={context.role} fixed={{ id: row.id }} /></ActionDisclosure> : null}
        {details.created_by === context.userId || ["owner", "admin"].includes(context.role) ? <ActionDisclosure><CoordinationMutationForm action="coverage.cancel" role={context.role} fixed={{ id: row.id }} /></ActionDisclosure> : null}
        <ActionDisclosure><CoordinationMutationForm action="coverage.reconcile" role={context.role} /></ActionDisclosure>
      </> : null}
      {view === "sessions" ? <ActionDisclosure open><CoordinationMutationForm action="decision.create" role={context.role} fixed={{ session_id: row.id }} /></ActionDisclosure> : null}
      {view === "requests" && (!details.resolution || details.requester_id === context.userId && !details.resolved_at) ? <ActionDisclosure open><CoordinationMutationForm action="request.progress" role={context.role} fixed={{ id: row.id }} /></ActionDisclosure> : null}
      {view === "corrections" && details.state === "open" && (details.steward_id === context.userId || details.backup_id === context.userId) ? <ActionDisclosure open><CoordinationMutationForm action="correction.review" role={context.role} fixed={{ id: row.id }} /></ActionDisclosure> : null}
    </div>
  </div>;
}

function ActionDisclosure({ children, open }: { children: React.ReactElement<{ action: CoordinationAction; role: string }>; open?: boolean }) {
  if (!canUseCoordinationAction(children.props.role, children.props.action)) return null;
  return <details open={open} className="rounded-2xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer py-2 text-sm font-bold text-slate-700">{ACTION_FORMS[children.props.action].title}</summary><div className="mt-3">{children}</div></details>;
}
