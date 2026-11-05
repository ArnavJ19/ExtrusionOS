"use client";

import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { ExecutionMutationForm, EXECUTION_ACTION_FORMS } from "./mutation-form";
import { MessageTools } from "./message-tools";
import { STAGES, WIP_STAGES, canUseExecutionAction, executionStatusLabel, type ExecutionAction, type ExecutionDetail, type ExecutionView } from "@/lib/workflow/execution";
import type { SessionContext } from "@/types/app";
import { formatDate } from "@/lib/utils/format";

function readable(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString("en-IN", { maximumFractionDigits: 3 });
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return `${new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} IST`;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) return Number(value).toLocaleString("en-IN", { maximumFractionDigits: 3 });
  return String(value).replaceAll("_", " ");
}
const list = <T,>(value: unknown) => (Array.isArray(value) ? value as T[] : []);
const record = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

function Facts({ entries }: { entries: [string, unknown][] }) {
  return <dl className="grid gap-4 sm:grid-cols-2">{entries.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs font-bold text-slate-500">{label}</dt><dd className="break-words text-sm text-slate-900">{readable(value)}</dd></div>)}</dl>;
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4"><h2 className="font-bold">{title}</h2>{children}</section>;
}
function ActionDisclosure({ children, open }: { children: ReactElement<{ action: ExecutionAction; role: string; title?: string }>; open?: boolean }) {
  if (!canUseExecutionAction(children.props.role, children.props.action)) return null;
  return <details open={open} className="rounded-2xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer py-2 text-sm font-bold text-slate-700">{children.props.title ?? EXECUTION_ACTION_FORMS[children.props.action].title}</summary><div className="mt-3">{children}</div></details>;
}

type Candidate = { user_id: string; name: string; role: string; hard_ok: boolean; hard_reasons: string[]; soft: string[]; open_tasks: number; estimated_minutes: number; unestimated_tasks: number; overdue_tasks: number; recommended: boolean };
type LoadOrder = { order_id: string; order_number: string; customer: string | null; stop_seq: number | null; unload_note: string | null; bundles: number; kg: number; site: string | null; appointment: string | null; held: boolean };
type LoadItem = { item_id: string; bundle: string | null; order_number: string; kg: number; pieces: number; stop_seq: number | null; confirmation: string | null; method: string | null; note: string | null };

export function ExecutionRecord({ view, detail, context }: { view: ExecutionView; detail: ExecutionDetail; context: SessionContext }) {
  const { row } = detail; const d = row.details; const role = context.role;
  const act = (name: ExecutionAction, fixed: Record<string, unknown>, open = false, title?: string) =>
    <ActionDisclosure open={open}><ExecutionMutationForm action={name} role={role} fixed={fixed} title={title} /></ActionDisclosure>;
  return <div className="space-y-5">
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="break-words text-xl font-bold">{row.label}</h2><Badge value={row.status} /></div>
      <p className="text-sm font-semibold text-slate-800">{executionStatusLabel(row.status)}</p>
      <p className="break-words text-sm text-slate-700">{row.summary}</p>
      {row.owner || row.due_date ? <p className="text-sm font-semibold">{row.owner ?? "Not assigned"}{row.due_date ? ` · ${formatDate(row.due_date)}` : ""}</p> : null}
      {row.source_href ? <Link href={row.source_href} className="inline-flex min-h-11 items-center text-sm font-bold underline">Open the source record</Link> : null}
      <p className="text-xs text-slate-500">Current authorized read as of {readable(detail.as_of)}. Every action rechecks current sources before it is recorded.</p>
    </section>

    {view === "appointments" ? (() => {
      const status = String(d.raw_status);
      return <>
        <Section title="Appointment"><Facts entries={[["Order", d.order_number], ["Dispatch", d.dispatch_number ?? "Whole order"], ["Customer", d.customer], ["Requested slot", `${readable(d.requested_start)} to ${readable(d.requested_end)}`],
          ["Confirmed slot", d.confirmed_start ? `${readable(d.confirmed_start)} to ${readable(d.confirmed_end)}` : "Not confirmed"], ["Confirmed by", d.confirmed_by_name], ["Actual arrival", d.arrived_at], ["Follow-up owner", d.follow_up_owner],
          ["Site address", d.site_address], ["Site revision", d.site_revision], ["Receiving contact", d.contact_name], ["Contact mobile", d.contact_phone], ["Access restrictions", d.access_restrictions], ["Preparation needed", d.preparations], ["Outcome note", d.outcome_note]]} />
          {d.differs_from_customer ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">This address differs from the customer&apos;s default: {readable(d.customer_default_address)}.</p> : null}
          {d.contact_masked ? <p className="text-xs text-slate-600">The full number is shown only to dispatch and sales.</p> : null}
          <p className="text-xs text-slate-600">A confirmation records what the site agreed. It does not release the dispatch or bypass stock, quality, credit or vehicle checks.</p></Section>
        <Section title={`Revisions (current ${readable(d.revision)})`}>{list<{ revision: number; reason: string; recorded_at: string; status: string; slot_start: string | null; site_address: string | null }>(d.revisions).length
          ? <ol className="space-y-2">{list<{ revision: number; reason: string; recorded_at: string; status: string; slot_start: string | null; site_address: string | null }>(d.revisions).map(item => <li key={item.revision} className="border-l-2 border-slate-200 pl-3 text-sm">
            <p className="font-semibold">Revision {item.revision}: {readable(item.status)}{item.slot_start ? ` · ${readable(item.slot_start)}` : ""}</p><p className="break-words text-slate-700">{item.site_address}</p><p className="text-xs text-slate-500">{item.reason} · {readable(item.recorded_at)}</p></li>)}</ol>
          : <p className="text-sm text-slate-600">No revisions recorded.</p>}</Section>
        <div className="space-y-4">
          {status === "requested" ? act("appointment.confirm", { id: row.id }, true) : null}
          {status === "confirmed" ? act("appointment.arrive", { id: row.id }, row.status !== "outcome_due") : null}
          {status === "arrived" || row.status === "outcome_due" ? act("appointment.outcome", { id: row.id }, true) : null}
          {["requested", "confirmed"].includes(status) ? <>{act("appointment.reschedule", { id: row.id })}{act("appointment.cancel", { id: row.id })}
            {act("message.prepare", { template: "appointment_notice", entity_id: row.id }, false, "Prepare a message to the customer")}</> : null}
        </div>
      </>;
    })() : null}

    {view === "gate_passes" ? (() => {
      const status = String(d.pass_status);
      return <>
        <Section title="Custody"><Facts entries={[["Item", d.item_label], ["Kind", d.item_kind], ["Die", d.die_number], ["Serial or tag", d.serial_ref], ["Issued", d.quantity], ["Returned", d.returned_quantity], ["of which damaged", d.damaged_quantity], ["Lost", d.lost_quantity], ["Outstanding", d.balance],
          ["Held by", `${readable(d.custodian_name)} (${readable(d.custodian_kind)})`], ["Why it left", d.purpose], ["Expected back", d.due_date], ["Original date", d.original_due_date], ["Extensions", d.extension_count], ["Return follow-up", d.follow_up_owner],
          ["Issued by", d.issued_by], ["Left at", d.departed_at], ["Receipt acknowledged by", d.acknowledged_by_name], ["Acknowledged at", d.acknowledged_at], ["Closed", d.closed_at], ["Closing note", d.close_note]]} />
          <p className="text-xs text-slate-600">This is returnable custody, not a sale or a permanent stock transfer. A die on an open pass is treated as with the custodian when planning.</p></Section>
        <Section title="Returns">{list<{ quantity: number; condition: string; note: string; recorded_at: string }>(d.returns).length ? <ul className="space-y-1 text-sm">{list<{ quantity: number; condition: string; note: string; recorded_at: string }>(d.returns).map((item, index) =>
          <li key={index}>{item.quantity} returned in {item.condition} condition · {item.note} · {readable(item.recorded_at)}</li>)}</ul> : <p className="text-sm text-slate-600">Nothing returned yet.</p>}</Section>
        <div className="space-y-4">
          {status === "approved" ? <>{act("gatepass.depart", { id: row.id }, true)}{act("gatepass.cancel", { id: row.id })}</> : null}
          {status === "out" ? <>{!d.acknowledged_at ? act("gatepass.acknowledge", { id: row.id }) : null}{act("gatepass.return", { id: row.id }, true)}{act("gatepass.extend", { id: row.id })}{act("gatepass.lose", { id: row.id })}</> : null}
        </div>
      </>;
    })() : null}

    {view === "loads" ? (() => {
      const orders = list<LoadOrder>(d.orders); const items = list<LoadItem>(d.items); const review = record(d.review); const findings = record(review.findings);
      return <>
        <Section title="Load"><Facts entries={[["Vehicle", `${readable(d.vehicle)} (${readable(d.registration)})`], ["Capacity (kg)", d.capacity_kg], ["Planned (kg)", d.planned_kg], ["Confirmed loaded (kg)", d.loaded_kg],
          ["Bundles confirmed", `${readable(d.items_confirmed)} of ${readable(d.items_total)}`], ["Orders", d.order_count], ["Orders without a stop", d.orders_without_stop]]} />
          {d.over_capacity ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">Planned weight is above the vehicle capacity recorded for this load. Remove material before loading.</p> : null}
          <p className="text-xs text-slate-600">Capacity is the figure recorded on the vehicle. No statutory limit is encoded here. Releasing the bundles stays in the dispatch workflow.</p></Section>
        <Section title="Unloading stops">{orders.length ? <ul className="space-y-3">{orders.map(order => <li key={order.order_id} className="min-w-0 space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
          <p className="font-semibold"><Link href={`/orders/${order.order_id}`} className="underline">{order.order_number}</Link> · {order.customer ?? "Customer"} · {order.bundles} bundle(s), {readable(order.kg)} kg</p>
          <p className="text-slate-700">{order.stop_seq ? `Stop ${order.stop_seq}` : "No stop set"}{order.site ? ` · ${order.site}` : ""}{order.unload_note ? ` · ${order.unload_note}` : ""}</p>
          {order.appointment ? <p className="text-amber-900">Appointment {readable(order.appointment)}{order.appointment === "requested" ? ": the site has not confirmed" : ""}</p> : null}
          {order.held ? <p className="font-semibold text-red-800">A production job for this order is on hold.</p> : null}
          {act("loadplan.stop", { load_id: row.id, order_id: order.order_id }, false, `Set the stop for ${order.order_number}`)}</li>)}</ul> : <p className="text-sm text-slate-600">No active bundles on this load.</p>}
          <p className="text-xs text-slate-600">The last stop is loaded first.</p></Section>
        <Section title="Loading order">{items.length ? <ul className="space-y-2">{items.map(item => <li key={item.item_id} className="min-w-0 space-y-2 text-sm"><p className="break-words"><span className="font-semibold">{item.bundle ?? "Bundle"}</span> · {item.order_number} · {readable(item.kg)} kg · {item.pieces} pieces · {item.stop_seq ? `stop ${item.stop_seq}` : "no stop"} ·{" "}
          <span className="font-semibold">{item.confirmation ? `${readable(item.confirmation)} (${item.method})` : "not confirmed"}</span></p>
          {act("loadplan.confirm", { item_id: item.item_id }, false, `Record loading of ${item.bundle ?? "this bundle"}`)}</li>)}</ul> : <p className="text-sm text-slate-600">Nothing to load.</p>}</Section>
        {review.outcome ? <Section title={`Latest review: ${review.outcome === "ready" ? "ready" : "not ready"}${review.current ? "" : " (the plan has changed since)"}`}>
          {list<string>(findings.blockers).length ? <ul className="list-disc space-y-1 pl-5 text-sm text-red-900">{list<string>(findings.blockers).map(item => <li key={item}>{item}</li>)}</ul> : <p className="text-sm text-emerald-900">No blocking findings.</p>}
          {list<string>(findings.warnings).length ? <ul className="list-disc space-y-1 pl-5 text-sm text-amber-950">{list<string>(findings.warnings).map(item => <li key={item}>{item}</li>)}</ul> : null}
          <p className="text-xs text-slate-600">Reviewed {readable(review.reviewed_at)}.</p></Section> : null}
        {row.status !== "closed" && row.status !== "cancelled" ? act("loadplan.review", { load_id: row.id }, true) : null}
      </>;
    })() : null}

    {view === "windows" ? (d.kind === "policy" ? <>
      <Section title="Window policy"><Facts entries={[["Scope", d.machine_name ?? "All presses"], ["Protected for the next (hours)", d.horizon_hours], ["Window reaches", d.window_end_date], ["Mode", d.enforce ? "Enforced by the server" : "Advisory"], ["Jobs inside the window", d.jobs_in_window],
        ["Why", d.reason], ["Set by", d.created_by]]} />
        <p className="text-xs text-slate-600">The window counts calendar days of the planned date in IST. Running work is never moved by this feature; maintenance and quality holds keep their own controls.</p></Section>
      {d.policy_status === "active" ? <>{act("window.retire", { id: row.id })}</> : null}
    </> : <>
      <Section title="Change request"><Facts entries={[["Job", d.job_number], ["Order", d.order_number], ["Job status", d.job_status], ["From", `${readable(d.previous_date)} ${d.previous_shift ?? ""}`], ["To", `${readable(d.new_date)} ${d.new_shift ?? ""}`], ["Reason", d.reason],
        ["Effect on the customer", d.customer_effect], ["Requested by", d.requested_by], ["Requested", d.requested_at], ["Decided by", d.decided_by], ["Decision note", d.decision_note]]} />
        {d.impact ? <Facts entries={[["Other jobs in the target slot", record(d.impact).displaced_or_shared_slot_jobs], ["Moves after expected dispatch", record(d.impact).moves_after_expected_dispatch], ["Billets short", record(d.impact).billets_short]]} /> : null}
        <p className="text-xs text-slate-600">{String(record(d.impact).not_modelled ?? "")}</p>
        {d.job_changed_since_request ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">The job changed after this request. It cannot be approved; reject it and request again against the current plan.</p> : null}</Section>
      {d.change_status === "requested" ? <>{d.requested_by_id !== context.userId ? act("window.approve", { id: row.id }, !d.job_changed_since_request) : <p className="rounded-xl bg-slate-50 p-3 text-sm">You requested this change. Another authorized person approves it.</p>}{act("window.reject", { id: row.id })}</> : null}
    </>) : null}

    {view === "wip" ? (() => {
      const stage = String(d.stage); const unit = String(d.unit ?? "");
      return <>
        <Section title={WIP_STAGES[stage as keyof typeof WIP_STAGES] ?? "Stage"}><Facts entries={[["Jobs here", d.jobs], ["Kilograms here", d.kg], ["Jobs without a recorded quantity", d.unmeasured_jobs], ["Oldest arrival", d.oldest_entered_at],
          ["Limit", d.limit_id ? `${readable(d.limit_value)} ${unit}` : "No limit set"], ["Position against the limit", d.limit_id ? `${readable(d.current_value)} ${unit}` : null], ["Why this limit", d.basis], ["Upstream", `${readable(d.upstream_jobs)} (${readable(d.upstream_basis)})`]]} />
          <p className="text-xs text-slate-600">Kilograms and jobs are never added together. A job with no recorded quantity is shown as unmeasured, not as zero. The limit is advisory and never blocks the stage.</p></Section>
        <Section title="Release decisions past the limit">{list<{ job: string; reason: string; wip: number; limit: number; unit: string; decided_at: string }>(d.decisions).length ? <ul className="space-y-1 text-sm">{list<{ job: string; reason: string; wip: number; limit: number; unit: string; decided_at: string }>(d.decisions).map((item, index) =>
          <li key={index}>{item.job}: {readable(item.wip)} {item.unit} against {readable(item.limit)} · {item.reason} · {readable(item.decided_at)}</li>)}</ul> : <p className="text-sm text-slate-600">None recorded.</p>}</Section>
        <div className="space-y-4">
          {d.limit_id ? act("wip.release", { stage }, row.status === "over") : null}
          {act("wip.set_limit", { stage }, !d.limit_id, d.limit_id ? "Replace the limit" : "Set an advisory limit")}
          {d.limit_id ? act("wip.retire_limit", { id: d.limit_id }) : null}
        </div>
      </>;
    })() : null}

    {view === "assignments" ? (() => {
      const candidates = list<Candidate>(d.candidates); const check = d.assignee_check ? record(d.assignee_check) : null;
      return <>
        <Section title="Task"><Facts entries={[["Type", d.task_type], ["Status", d.task_status], ["Priority", d.priority], ["Due", row.due_date], ["Assigned to", row.owner], ["Rule", d.rule ? `Roles ${list<string>(record(d.rule).allowed_roles).join(", ")}${record(d.rule).competency ? `; requires ${String(record(d.rule).competency)}` : ""}` : "No rule: role and status only"]]} />
          {check && !check.hard_ok ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-900">The current assignee is no longer eligible: {list<string>(check.hard_reasons).join("; ")}. The task has not been moved.</p> : null}
          {d.running_task_note ? <p className="text-sm text-slate-700">{String(d.running_task_note)}</p> : null}</Section>
        <Section title="Who could take it"><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b"><th scope="col" className="py-2 pr-3">Person</th><th scope="col" className="py-2 pr-3">Eligibility</th><th scope="col" className="py-2 pr-3">Open tasks</th>
          <th scope="col" className="py-2 pr-3">Estimated minutes</th><th scope="col" className="py-2">Notes</th></tr></thead>
          <tbody>{candidates.map(c => <tr key={c.user_id} className="border-b align-top last:border-0"><td className="py-2 pr-3 font-semibold">{c.name}<span className="block text-xs font-normal text-slate-500">{readable(c.role)}</span></td>
            <td className="py-2 pr-3">{c.hard_ok ? (c.recommended ? "Eligible and available (lightest list)" : "Eligible") : <span className="text-red-900">{c.hard_reasons.join("; ")}</span>}</td>
            <td className="py-2 pr-3">{c.open_tasks}{c.overdue_tasks ? ` (${c.overdue_tasks} overdue)` : ""}</td><td className="py-2 pr-3">{c.estimated_minutes}{c.unestimated_tasks ? ` + ${c.unestimated_tasks} unestimated` : ""}</td><td className="py-2">{c.soft.join("; ") || "None"}</td></tr>)}</tbody></table></div>
          <p className="text-xs text-slate-600">Counts show who is already committed. They are not a performance measure and a lower count is not a ranking. Unestimated work is a stated lower bound, never zero.</p></Section>
        {d.task_status === "open" ? act("assignment.assign", { id: row.id }, true) : null}
      </>;
    })() : null}

    {view === "rules" ? (d.kind === "rule" ? <>
      <Section title="Assignment rule"><Facts entries={[["Task type", d.task_type], ["Roles", list<string>(d.allowed_roles).join(", ")], ["Required competency", d.competency], ["Typical minutes", d.estimate_minutes], ["Set by", d.created_by]]} />
        <p className="text-xs text-slate-600">Roles and a required competency are hard eligibility. Delegation does not grant authority.</p></Section>
      {d.rule_status === "active" ? act("rule.retire", { id: row.id }) : null}
    </> : <>
      <Section title="Unavailability"><Facts entries={[["Employee", d.employee], ["From", d.starts_on], ["To", d.ends_on], ["Reason", d.availability_kind], ["Recorded by", d.recorded_by], ["Cancelled", d.cancelled_at]]} />
        <p className="text-xs text-slate-600">Visible to supervisors only. It informs recommendations; it does not move assigned work.</p></Section>
      {!d.cancelled_at ? act("availability.cancel", { id: row.id }) : null}
    </>) : null}

    {view === "routes" ? (d.kind === "family" ? <>
      <Section title="Route"><Facts entries={[["Code and version", `${readable(d.code)} v${readable(d.version)}`], ["Use when", d.applies_when], ["Required stages", list<string>(d.required_stages).map(s => STAGES[s as keyof typeof STAGES] ?? s).join(", ")],
        ["Optional stages", list<string>(d.optional_stages).map(s => STAGES[s as keyof typeof STAGES] ?? s).join(", ") || "None"], ["Defined by", d.created_by], ["Approved by", d.approved_by], ["Orders following it", d.orders_bound]]} />
        <p className="text-xs text-slate-600">An omitted stage is a recorded policy choice, not a completion. Order confirmation, packing and dispatch are always required, and a route never bypasses stock, quality, finance or tenant controls.</p></Section>
      <div className="space-y-4">
        {d.family_status === "draft" && d.created_by_id !== context.userId ? act("route.approve", { id: row.id }, true) : null}
        {d.family_status === "draft" && d.created_by_id === context.userId ? <p className="rounded-xl bg-slate-50 p-3 text-sm">You defined this route. Another authorized person approves it.</p> : null}
        {d.family_status === "approved" ? act("route.bind", { family_id: row.id }, false, "Bind an order to this route") : null}
        {d.family_status !== "retired" ? act("route.retire", { id: row.id }) : null}
      </div>
    </> : <>
      <Section title="Deviation request"><Facts entries={[["Order", d.order_number], ["Route", d.route], ["Stage to skip", d.stage], ["Reason", d.reason], ["Requested by", d.requested_by], ["Status", d.deviation_status], ["Decided by", d.decided_by], ["Decision note", d.decision_note]]} /></Section>
      {d.deviation_status === "requested" ? (d.requested_by_id !== context.userId ? act("route.decide", { id: row.id }, true) : <p className="rounded-xl bg-slate-50 p-3 text-sm">You requested this deviation. Another authorized person decides it.</p>) : null}
    </>) : null}

    {view === "messages" ? <>
      <MessageTools id={row.id} details={d} />
      {d.message_state === "prepared" ? <div className="space-y-4">{act("message.mark", { id: row.id }, true)}{act("message.cancel", { id: row.id })}</div> : null}
    </> : null}

    {view === "queue" ? <Section title="Task"><Facts entries={[["Type", d.task_type], ["Status", d.task_status], ["Priority", d.priority], ["Planned date", d.due_date], ["Assigned to", row.owner]]} />
      <Link href="/tasks/execution/database?view=queue" className="inline-flex min-h-11 items-center text-sm font-bold underline">Update tasks from the queue</Link></Section> : null}
  </div>;
}
