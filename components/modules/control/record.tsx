"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ControlMutationForm, CONTROL_ACTION_FORMS } from "./mutation-form";
import { FulfilmentLines } from "./fulfilment-lines";
import { CUSTODY_CATEGORIES, canUseControlAction, controlStatusLabel, ledgerSchema, type ControlAction, type ControlDetail, type ControlView } from "@/lib/workflow/operations-control";
import type { SessionContext } from "@/types/app";
import { formatDate } from "@/lib/utils/format";

const TITLES: Record<string, string> = {
  customer: "Customer", stage: "Order stage", job_status: "Job status", order_number: "Order", team: "Receiving team", kind: "Change recorded", outcome: "Automatic outcome",
  task_status: "Handoff task status", acceptance_state: "Acceptance when the source changed", previous_quantity_kg: "Handoff quantity (kg)", current_quantity_kg: "Source quantity now (kg)",
  resolution_note: "Resolution", resolved_at: "Resolved at", demand_kg: "Order shortage demand (kg)", free_stock_kg: "Free billet stock (kg)", open_supply_kg: "Confirmed open purchase supply (kg)",
  tentative_supply_kg: "Draft purchase supply, not netted (kg)", safety_stock_kg: "Safety stock (kg)", net_shortage_kg: "Net shortage (kg)", proposed_kg: "Proposed purchase (kg)",
  need_by: "Earliest need date", order_by: "Order by", review_note: "Review note", generated_at: "Plan generated", overdue_to_order: "Order-by date passed",
  stage_label: "Stage", entered_at: "Entered stage", age_hours: "Hours in stage", quantity_kg: "Quantity (kg)", quantity_basis: "Quantity basis", vendor: "Vendor",
  location: "Last observed location", location_observed_at: "Location observed at", location_quantity_kg: "Quantity seen (kg)", observed_by: "Observed by",
  issued_kg: "Issued to vendor (kg)", accepted_kg: "Accepted back (kg)", rejected_kg: "Rejected back (kg)", explained_kg: "Explained differences (kg)", unaccounted_kg: "Not yet accounted (kg)",
  finishing_type: "Finishing", status: "Finishing status", sent_date: "Sent", received_date: "Received", expected_return: "Expected return", lead_time_known: "Lead time configured",
  order_due: "Order dispatch date", age_days: "Days since sent", policy_active: "Exception policy active", unit: "Measured in", revision: "Revision in force", effective_from: "Effective from",
  your_role: "Your role", you_can_request: "You can request", you_can_approve: "You can approve", your_ceiling: "Your approval limit",
  task_kind: "Task kind", exclusive_source: "One source per task", published_at: "Published", bound_open: "Open tasks on this revision", open_on_older: "Open tasks on earlier revisions",
  version_no: "Version", change_class: "Rollout", change_summary: "What changed", in_flight_policy: "Work already started", released_at: "Released", affected_tasks: "Open bound tasks",
  unassigned_tasks: "Bound tasks without an assignee", acknowledged_count: "Acknowledgements", you_acknowledged: "You acknowledged", older_version_work: "Open work on earlier versions", is_latest: "Latest released version"
};

function readable(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString("en-IN", { maximumFractionDigits: 3 });
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return `${new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) return Number(value).toLocaleString("en-IN", { maximumFractionDigits: 3 });
  return String(value).replaceAll("_", " ");
}
const list = <T,>(value: unknown) => (Array.isArray(value) ? value as T[] : []);

function Facts({ details }: { details: Record<string, unknown> }) {
  const entries = Object.entries(details).filter(([key, value]) => TITLES[key] && (value === null || typeof value !== "object"));
  return entries.length ? <dl className="grid gap-4 sm:grid-cols-2">{entries.map(([key, value]) => <div key={key} className="min-w-0"><dt className="text-xs font-bold text-slate-500">{TITLES[key]}</dt><dd className="break-words text-sm text-slate-900">{readable(value)}</dd></div>)}</dl> : null;
}

export function ControlRecord({ view, detail, context }: { view: ControlView; detail: ControlDetail; context: SessionContext }) {
  const { row } = detail;
  const details = row.details;
  const ledgerFields = Object.fromEntries(Object.entries(details).filter(([key]) => key !== "customer" && key !== "stage"));
  const ledger = view === "ledger" ? ledgerSchema.safeParse({ ...ledgerFields, order_id: row.id, as_of: detail.as_of }) : null;
  return <div className="space-y-5">
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="break-words text-xl font-bold">{row.label}</h2><Badge value={row.status} /></div>
      <p className="text-sm font-semibold text-slate-800">{controlStatusLabel(view, row.status)}</p>
      <p className="text-sm text-slate-700">{row.summary}</p>
      {row.owner || row.due_date ? <p className="text-sm font-semibold">{row.owner ?? "Not assigned"}{row.due_date ? ` · ${view === "procurement" ? "Order by" : view === "custody" ? "Expected back" : "Due"} ${formatDate(row.due_date)}` : ""}</p> : null}
      {row.source_href ? <Link href={row.source_href} className="inline-flex min-h-11 items-center text-sm font-bold underline">Open the source workflow</Link> : null}
      {view !== "ledger" ? <Facts details={details} /> : null}
      <p className="text-xs text-slate-500">Current authorized read as of {readable(detail.as_of)}. Every action rechecks current sources before it is recorded.</p>
    </section>
    {view === "ledger" ? ledger?.success ? <FulfilmentLines ledger={ledger.data} /> : <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-950">The fulfilment lines could not be verified. Reload before relying on these balances.</p> : null}
    {view === "inheritance" ? <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"><h2 className="font-bold">Facts compared with the current order line</h2>
      {list<{ field: string; job_value: unknown; line_value: unknown; overridden: boolean; override_reason: string | null }>(details.fields).length ? <ul className="space-y-2">{list<{ field: string; job_value: unknown; line_value: unknown; overridden: boolean; override_reason: string | null }>(details.fields).map(item => <li key={item.field} className="rounded-xl bg-slate-50 p-3 text-sm">
        <p className="font-bold capitalize">{item.field.replaceAll("_", " ")}</p><p>Job: {readable(item.job_value)} · Order line: {readable(item.line_value)}</p>
        {item.overridden ? <p className="text-xs text-slate-600">Recorded as deliberate: {item.override_reason}</p> : null}</li>)}</ul> : <p className="text-sm text-slate-600">No differences. The job carries the order line&apos;s technical and packing facts.</p>}
      <p className="text-xs text-slate-600">Quantities, prices and status are never copied by a refresh. Started jobs keep the facts they were made with.</p></section> : null}
    {view === "procurement" ? <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"><h2 className="font-bold">Why this purchase is proposed</h2>
      <ul className="space-y-1 text-sm">{list<{ order_id: string; order_number: string; kg: number; need_by: string | null }>(details.demand).map(order => <li key={order.order_id}><Link className="font-semibold underline" href={`/orders/${order.order_id}`}>{order.order_number}</Link> · {readable(order.kg)} kg short · needed {order.need_by ? formatDate(order.need_by) : "date unknown"}</li>)}</ul>
      {list<string>(details.warnings).length ? <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{list<string>(details.warnings).map(text => <li key={text}>{text}</li>)}</ul> : null}</section> : null}
    {view === "custody" ? <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"><h2 className="font-bold">Explained differences</h2>
      {list<{ id: string; category: keyof typeof CUSTODY_CATEGORIES; kg: number; evidence: string; recorded_at: string }>(details.explanations).length ? <ul className="space-y-3">{list<{ id: string; category: keyof typeof CUSTODY_CATEGORIES; kg: number; evidence: string; recorded_at: string }>(details.explanations).map(item => <li key={item.id} className="rounded-xl bg-slate-50 p-3 text-sm">
        <p className="font-bold">{CUSTODY_CATEGORIES[item.category] ?? item.category} · {readable(item.kg)} kg</p><p className="break-words">{item.evidence}</p><p className="text-xs text-slate-500">{readable(item.recorded_at)}</p>
        <ActionDisclosure><ControlMutationForm action="custody.reverse" role={context.role} fixed={{ id: item.id }} /></ActionDisclosure></li>)}</ul> : <p className="text-sm text-slate-600">No differences explained yet.</p>}
      <p className="text-xs text-slate-600">Custody is material only. Vendor rates, charges and claims stay in their own workflows.</p></section> : null}
    {view === "authority" ? <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"><h2 className="font-bold">Approval limits by role</h2>
      {Object.keys((details.limits ?? {}) as object).length ? <ul className="space-y-1 text-sm">{Object.entries(details.limits as Record<string, number>).map(([entry, limit]) => <li key={entry}><span className="font-semibold capitalize">{entry.replaceAll("_", " ")}</span>: up to {readable(limit)} {String(details.unit)}</li>)}</ul> : <p className="text-sm text-slate-600">No role limits. The existing exception policy decides who may approve.</p>}
      <p className="text-sm">Approver roles: {list<string>(details.approver_roles).map(entry => entry.replaceAll("_", " ")).join(", ") || "none (policy not set)"}. Owners are never limited.</p>
      {details.scheduled ? <p className="text-sm text-amber-900">Revision {readable((details.scheduled as { revision: number }).revision)} takes effect {readable((details.scheduled as { effective_from: string }).effective_from)}.</p> : null}</section> : null}
    {view === "contracts" ? <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"><h2 className="font-bold">What done means</h2>
      {list<{ label: string; kind: string }>(details.criteria).length ? <ol className="list-decimal space-y-1 pl-5 text-sm">{list<{ label: string; kind: string }>(details.criteria).map((item, index) => <li key={index}>{item.label} <span className="text-slate-500">({item.kind.replaceAll("_", " ")})</span></li>)}</ol> : <p className="text-sm text-slate-600">Not published yet.</p>}
      {row.status === "templates_changed" ? <><p className="text-sm text-amber-900">The active criteria differ from the published revision. New tasks still copy the active criteria; publish to record a numbered revision.</p>
        <ol className="list-decimal space-y-1 pl-5 text-sm">{list<{ label: string }>(details.live_criteria).map((item, index) => <li key={index}>{item.label}</li>)}</ol></> : null}</section> : null}
    {view === "rollouts" ? <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"><h2 className="font-bold">Employees with bound open work</h2>
      {list<{ name: string; acknowledged: boolean; active: boolean }>(details.employees).length ? <ul className="space-y-1 text-sm">{list<{ name: string; acknowledged: boolean; active: boolean }>(details.employees).map((person, index) => <li key={index}>{person.name}: {person.acknowledged ? "acknowledged" : "not yet acknowledged"}{person.active ? "" : " (inactive; reassign the work)"}</li>)}</ul> : <p className="text-sm text-slate-600">No assigned open work is bound to this version.</p>}
      <p className="text-xs text-slate-600">An acknowledgement records that the change was read. It does not certify competence; qualification rules stay in Competencies.</p></section> : null}
    <div className="space-y-4">
      {view === "inheritance" && row.status === "drifted" ? <ActionDisclosure open><ControlMutationForm action="facts.refresh" role={context.role} fixed={{ job_id: row.id }} /></ActionDisclosure> : null}
      {view === "inheritance" && ["drifted", "drift_locked"].includes(row.status) ? <ActionDisclosure><ControlMutationForm action="facts.keep" role={context.role} fixed={{ job_id: row.id }} /></ActionDisclosure> : null}
      {view === "handoffs" && row.status === "open" ? <ActionDisclosure open><ControlMutationForm action="handoff.resolve" role={context.role} fixed={{ id: row.id }} /></ActionDisclosure> : null}
      {view === "procurement" && row.status === "proposed" ? <ActionDisclosure open><ControlMutationForm action="plan.review" role={context.role} fixed={{ id: row.id }} /></ActionDisclosure> : null}
      {view === "wip" ? <ActionDisclosure><ControlMutationForm action="wip.observe" role={context.role} fixed={{ job_id: row.id }} /></ActionDisclosure> : null}
      {view === "custody" && row.status !== "reconciled" ? <ActionDisclosure><ControlMutationForm action="custody.explain" role={context.role} fixed={{ job_id: row.id }} /></ActionDisclosure> : null}
      {view === "authority" ? <ActionDisclosure><ControlMutationForm action="authority.publish" role={context.role} fixed={{ decision_type: details.decision_type }} /></ActionDisclosure> : null}
      {view === "contracts" && row.status !== "published" ? <ActionDisclosure open><ControlMutationForm action="contract.publish" role={context.role} fixed={{ task_kind: row.label }} /></ActionDisclosure> : null}
      {view === "rollouts" && details.is_latest && row.status !== "withdrawn" ? <ActionDisclosure><ControlMutationForm action="rollout.classify" role={context.role} fixed={{ version_id: row.id }} /></ActionDisclosure> : null}
      {view === "rollouts" && !details.you_acknowledged && row.status !== "withdrawn" ? <ActionDisclosure open={row.status === "awaiting_acknowledgement"}><ControlMutationForm action="rollout.acknowledge" role={context.role} fixed={{ version_id: row.id }} /></ActionDisclosure> : null}
    </div>
  </div>;
}

function ActionDisclosure({ children, open }: { children: React.ReactElement<{ action: ControlAction; role: string }>; open?: boolean }) {
  if (!canUseControlAction(children.props.role, children.props.action)) return null;
  return <details open={open} className="rounded-2xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer py-2 text-sm font-bold text-slate-700">{CONTROL_ACTION_FORMS[children.props.action].title}</summary><div className="mt-3">{children}</div></details>;
}
