"use client";

import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { AssuranceMutationForm, ASSURANCE_ACTION_FORMS } from "./mutation-form";
import { CHANGE_FIELDS, DELIVERY_DISPOSITIONS, DELIVERY_RESOLUTIONS, RETURN_RESPONSES, assuranceStatusLabel, canUseAssuranceAction, type AssuranceAction, type AssuranceDetail, type AssuranceView } from "@/lib/workflow/assurance";
import type { SessionContext } from "@/types/app";
import { formatDate } from "@/lib/utils/format";

const TITLES: Record<string, string> = {
  drawing_number: "Drawing", title: "Title", revision_label: "Revision", file_name: "File", file_sha256: "File checksum (SHA-256)", profile_code: "Profile", customer_approval_required: "Customer approval required",
  released_revision: "Released revision for the profile", affected_count: "Unfinished jobs on another revision", affected_lines: "Live order lines on another revision", registered_at: "Registered",
  po_number: "Purchase order", line_number: "Line", description: "Material", specification: "Specification", vendor: "Supplier", receipt_date: "Received", receipt_reference: "Receipt reference", age_days: "Days since receipt",
  unit: "Unit", received: "Received", gate_rejected: "Rejected at the gate", accepted: "Accepted by quality", concession: "Accepted under concession", rejected: "Rejected by quality", returned: "Returned to supplier",
  released: "Released to stock", pending_qc: "Awaiting quality decision", awaiting_return: "Rejected, awaiting return", releasable: "Accepted, not yet released",
  dispatch_number: "Dispatch", order_number: "Order", customer: "Customer", delivery_status: "Delivery status", departed_at: "Departed", delivered_at: "Delivered", proof_of_delivery_recorded: "Proof of delivery file",
  shipped_kg: "Shipped (kg)", accepted_kg: "Accepted (kg)", refused_kg: "Refused (kg)", damaged_kg: "Damaged (kg)", short_kg: "Reported short (kg)", undisposed_kg: "Not yet confirmed (kg)", open_exceptions: "Open exceptions",
  reason: "Reason", proposed_by: "Proposed by", proposed_at: "Proposed", decided_by: "Decided by", decided_at: "Decided", decision_note: "Decision note", stale: "Line changed after assessment", line_updated: "Line carries the proposed values", open_impacts: "Open impact actions",
  code: "Code", name: "Name", procedure_title: "Procedure", validity_months: "Validity (months)", independent_count: "Independent", supervised_count: "Supervised", trained_count: "Trained", requalification_count: "Need requalification", expiring_count: "Expire within 30 days",
  range_min: "Range from", range_max: "Range to", location: "Location", instrument_status: "Instrument status", withdrawn_reason: "Withdrawn because", evidence_state: "Evidence now", valid_until: "Valid until", certificate_ref: "Certificate", bound_results: "Results measured with it", open_reviews: "Open impact reviews", policy_mode: "Company evidence policy",
  kind: "Unavailability", machine: "Press", machine_status: "Press status", starts_at: "From", ends_at: "Until", end_known: "End confirmed", estimated_end: "Estimated end", source_status: "Source status",
  blind: "Blind count", cutoff_at: "Movement cutoff", count_status: "Count status", total: "Lines", pending: "To count", review: "To review", recount: "To recount", resolved: "Resolved", closure_note: "Closure note", expected_hidden: "Expected quantities hidden from you",
  ready: "Ready to issue", missing: "Outstanding mandatory requirements", dispatch_status: "Dispatch status", current_version: "Issued version", issued_at: "Issued",
  response: "Approved response", bundle_number: "Bundle", expected_kg: "Authorized (kg)", received_kg: "Received (kg)", disposed_kg: "Inspected and disposed (kg)", undisposed_receipts: "Receipts awaiting inspection", credited_kg: "Credited (kg)",
  replacement_dispatched_kg: "Replacement dispatched (kg)", replacement_in_production_kg: "Replacement in production (kg)", resolved_kg: "Resolved (kg)", owed_kg: "Still owed (kg)", from_delivery_exception: "Raised from a delivery exception", closed_at: "Closed"
};
const HIDDEN = new Set(["file_sha256"]);

function readable(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString("en-IN", { maximumFractionDigits: 3 });
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return `${new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) return Number(value).toLocaleString("en-IN", { maximumFractionDigits: 3 });
  return String(value).replaceAll("_", " ");
}
const list = <T,>(value: unknown) => (Array.isArray(value) ? value as T[] : []);
const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));

function Facts({ details }: { details: Record<string, unknown> }) {
  const entries = Object.entries(details).filter(([key, value]) => TITLES[key] && !HIDDEN.has(key) && (value === null || typeof value !== "object"));
  return entries.length ? <dl className="grid gap-4 sm:grid-cols-2">{entries.map(([key, value]) => <div key={key} className="min-w-0"><dt className="text-xs font-bold text-slate-500">{TITLES[key]}</dt><dd className="break-words text-sm text-slate-900">{readable(value)}</dd></div>)}</dl> : null;
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"><h2 className="font-bold">{title}</h2>{children}</section>;
}
function ActionDisclosure({ children, open }: { children: ReactElement<{ action: AssuranceAction; role: string; title?: string }>; open?: boolean }) {
  if (!canUseAssuranceAction(children.props.role, children.props.action)) return null;
  return <details open={open} className="rounded-2xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer py-2 text-sm font-bold text-slate-700">{children.props.title ?? ASSURANCE_ACTION_FORMS[children.props.action].title}</summary><div className="mt-3">{children}</div></details>;
}

export function AssuranceRecord({ view, detail, context }: { view: AssuranceView; detail: AssuranceDetail; context: SessionContext }) {
  const { row } = detail; const d = row.details; const role = context.role;
  const action = (name: AssuranceAction, fixed: Record<string, unknown>, open = false, title?: string) => <ActionDisclosure open={open}><AssuranceMutationForm action={name} role={role} fixed={fixed} title={title} /></ActionDisclosure>;
  return <div className="space-y-5">
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="break-words text-xl font-bold">{row.label}</h2><Badge value={row.status} /></div>
      <p className="text-sm font-semibold text-slate-800">{assuranceStatusLabel(row.status)}</p>
      <p className="text-sm text-slate-700">{row.summary}</p>
      {row.owner || row.due_date ? <p className="text-sm font-semibold">{row.owner ?? "Not assigned"}{row.due_date ? ` · ${formatDate(row.due_date)}` : ""}</p> : null}
      {row.source_href ? <Link href={row.source_href} className="inline-flex min-h-11 items-center text-sm font-bold underline">Open the source workflow</Link> : null}
      <Facts details={d} />
      <p className="text-xs text-slate-500">Current authorized read as of {readable(detail.as_of)}. Every action rechecks current sources before it is recorded.</p>
    </section>

    {view === "drawings" ? <>
      <Section title="Revision comparison">
        <p className="break-all text-sm"><span className="font-semibold">This revision:</span> {String(d.revision_label)} · checksum {String(d.file_sha256 ?? "").slice(0, 16)}… · {readable(d.technical_note)}</p>
        {d.previous ? <p className="break-all text-sm"><span className="font-semibold">Previous revision:</span> {String((d.previous as Record<string, unknown>).revision_label)} · checksum {String((d.previous as Record<string, unknown>).file_sha256 ?? "").slice(0, 16)}… · {readable((d.previous as Record<string, unknown>).technical_note)}</p> : <p className="text-sm text-slate-600">No earlier revision is registered for this drawing.</p>}
      </Section>
      <Section title="Approval and release history">{list<{ event: string; evidence: string; customer_contact: string | null; valid_until: string | null; job_number: string | null; by: string; at: string }>(d.events).length
        ? <ol className="space-y-3">{list<{ event: string; evidence: string; customer_contact: string | null; valid_until: string | null; job_number: string | null; by: string; at: string }>(d.events).map((event, index) => <li key={index} className="border-l-2 border-slate-200 pl-3 text-sm">
          <p className="font-bold">{readable(event.event)}{event.customer_contact ? ` · ${event.customer_contact}` : ""}{event.job_number ? ` · job ${event.job_number} until ${readable(event.valid_until)}` : ""}</p><p className="break-words">{event.evidence}</p><p className="text-xs text-slate-500">{event.by} · {readable(event.at)}</p></li>)}</ol>
        : <p className="text-sm text-slate-600">Registered only. Customer approval and release are recorded separately.</p>}</Section>
      {row.status === "released" ? <Section title="Unfinished work on another revision">{list<{ job_id: string; job_number: string; status: string; revision: string | null }>(d.affected_jobs).length
        ? <ul className="space-y-1 text-sm">{list<{ job_id: string; job_number: string; status: string; revision: string | null }>(d.affected_jobs).map(job => <li key={job.job_id}><Link className="font-semibold underline" href={`/production/${job.job_id}`}>{job.job_number ?? "Job"}</Link> · {readable(job.status)} · revision {job.revision ?? "none"}</li>)}</ul>
        : <p className="text-sm text-slate-600">All unfinished jobs for this profile carry the released revision.</p>}
        <p className="text-xs text-slate-600">Unstarted jobs cannot start on another revision unless a deviation is recorded. Running jobs continue and need review.</p></Section> : null}
      <div className="space-y-4">
        {["registered", "submitted", "customer_query"].includes(row.status) ? action("drawing.customer", { revision_id: row.id }, row.status !== "registered") : null}
        {row.status === "customer_approved" || (row.status === "registered" && d.customer_approval_required === false) ? action("drawing.release", { revision_id: row.id }, true) : null}
        {row.status !== "released" && d.released_revision && d.released_revision !== d.revision_label ? action("drawing.deviation", { revision_id: row.id }) : null}
        {!["superseded", "withdrawn"].includes(row.status) ? action("drawing.withdraw", { revision_id: row.id }) : null}
      </div>
    </> : null}

    {view === "incoming" ? <>
      <Section title="Quality decisions">{list<{ id: string; disposition: string; quantity: number; certificate_ref: string | null; evidence: string; by: string; role: string; at: string; reversed: boolean; reverse_note: string | null }>(d.dispositions).length
        ? <ul className="space-y-3">{list<{ id: string; disposition: string; quantity: number; certificate_ref: string | null; evidence: string; by: string; role: string; at: string; reversed: boolean; reverse_note: string | null }>(d.dispositions).map(item => <li key={item.id} className="rounded-xl bg-slate-50 p-3 text-sm">
          <p className="font-bold">{readable(item.disposition)} · {readable(item.quantity)} {String(d.unit)}{item.reversed ? " · reversed" : ""}</p><p className="break-words">{item.evidence}{item.certificate_ref ? ` · certificate ${item.certificate_ref}` : ""}</p>
          <p className="text-xs text-slate-500">{item.by} ({readable(item.role)}) · {readable(item.at)}{item.reverse_note ? ` · reversed: ${item.reverse_note}` : ""}</p>
          {!item.reversed && item.disposition !== "returned" ? action("incoming.reverse", { id: item.id }) : null}</li>)}</ul> : <p className="text-sm text-slate-600">No quality decision yet. Received material is not usable until it is accepted and released.</p>}</Section>
      {list<{ batch_number: string; kg: number; at: string }>(d.releases).length ? <Section title="Released billet batches"><ul className="space-y-1 text-sm">{list<{ batch_number: string; kg: number; at: string }>(d.releases).map(item => <li key={item.batch_number}>{item.batch_number} · {readable(item.kg)} kg · {readable(item.at)}</li>)}</ul></Section> : null}
      <div className="space-y-4">
        {num(d.pending_qc) > 0 ? action("incoming.dispose", { receipt_line_id: row.id }, true) : null}
        {num(d.releasable) > 0 ? action("incoming.release", { receipt_line_id: row.id }, true) : null}
        {num(d.awaiting_return) > 0 ? action("incoming.return", { receipt_line_id: row.id }) : null}
      </div>
    </> : null}

    {view === "deliveries" ? <>
      <Section title="Bundles shipped">{list<{ id: string; bundle_number: string; net_kg: number; accepted_kg: number; refused_kg: number; damaged_kg: number; short_kg: number; undisposed_kg: number }>(d.bundles).map(bundle => <div key={bundle.id} className="space-y-2 border-b border-slate-100 pb-3 last:border-0">
        <p className="text-sm"><span className="font-bold">Bundle {bundle.bundle_number}</span> · {readable(bundle.net_kg)} kg shipped · {readable(bundle.accepted_kg)} accepted · {readable(num(bundle.refused_kg) + num(bundle.damaged_kg) + num(bundle.short_kg))} in exceptions · {readable(bundle.undisposed_kg)} not confirmed</p>
        {num(bundle.undisposed_kg) > 0 ? action("delivery.record", { packing_item_id: bundle.id }, false, `Record bundle ${bundle.bundle_number}`) : null}</div>)}</Section>
      <Section title="Customer dispositions">{list<{ id: string; bundle_number: string; disposition: keyof typeof DELIVERY_DISPOSITIONS; kg: number; receiver: string; evidence: string; owner: string; recorded_at: string; resolution: keyof typeof DELIVERY_RESOLUTIONS | null; resolution_note: string | null; return_authorization_id: string | null }>(d.dispositions).length
        ? <ul className="space-y-3">{list<{ id: string; bundle_number: string; disposition: keyof typeof DELIVERY_DISPOSITIONS; kg: number; receiver: string; evidence: string; owner: string; recorded_at: string; resolution: keyof typeof DELIVERY_RESOLUTIONS | null; resolution_note: string | null; return_authorization_id: string | null }>(d.dispositions).map(item => <li key={item.id} className="rounded-xl bg-slate-50 p-3 text-sm">
          <p className="font-bold">Bundle {item.bundle_number} · {DELIVERY_DISPOSITIONS[item.disposition]} · {readable(item.kg)} kg</p><p className="break-words">{item.evidence} · {item.receiver}</p>
          <p className="text-xs text-slate-500">Owner {item.owner} · {readable(item.recorded_at)}{item.resolution ? ` · ${DELIVERY_RESOLUTIONS[item.resolution]}: ${item.resolution_note}` : ""}</p>
          {item.return_authorization_id ? <Link href={`/tasks/assurance/returns/${item.return_authorization_id}`} className="inline-flex min-h-11 items-center font-bold underline">Open the return</Link> : null}
          {item.disposition !== "accepted" && !item.resolution ? action("delivery.resolve", { id: item.id }) : null}
          {!item.resolution ? action("delivery.reverse", { id: item.id }) : null}</li>)}</ul> : <p className="text-sm text-slate-600">No customer disposition recorded yet.</p>}
        <p className="text-xs text-slate-600">A customer-reported shortage is not a verified stock discrepancy until stores verify it. Stock, credit and returns follow their own workflows.</p></Section>
    </> : null}

    {view === "revisions" ? <>
      <Section title="Proposed change"><ul className="space-y-1 text-sm">{Object.entries((d.changes ?? {}) as Record<string, { from: unknown; to: unknown }>).map(([key, change]) => <li key={key}><span className="font-semibold">{CHANGE_FIELDS[key as keyof typeof CHANGE_FIELDS] ?? key}</span>: {readable(change.from)} → {readable(change.to)}</li>)}</ul>
        <p className="text-xs text-slate-600">The proposal changes nothing by itself. After approval, update the line through the order workflow; issued documents and posted transactions are corrected through their own processes.</p></Section>
      <Section title="Downstream impact">{list<{ id: string; domain: string; label: string; classification: string; owner_role: string; required_action: string; status: string; resolution_note: string | null; you_can_resolve: boolean }>(d.impacts).map(item => <div key={item.id} className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
        <p className="font-bold">{item.label} · {readable(item.classification)} · {readable(item.status)}</p><p>{item.required_action}</p><p className="text-xs text-slate-500">Owner: {readable(item.owner_role)}{item.resolution_note ? ` · ${item.resolution_note}` : ""}</p>
        {item.status === "open" && row.status === "approved" && item.you_can_resolve ? action("change.resolve", { id: item.id }) : null}</div>)}</Section>
      {row.status === "assessed" && !d.you_proposed ? action("change.decide", { id: row.id }, true) : null}
    </> : null}

    {view === "capability" ? <>
      <Section title="People and standing">{list<{ employee_id: string; name: string; level: string; effective: string; reason: string | null; expires_at: string | null }>(d.holders).length
        ? <ul className="space-y-1 text-sm">{list<{ employee_id: string; name: string; level: string; effective: string; reason: string | null; expires_at: string | null }>(d.holders).map(person => <li key={person.employee_id}>{person.name}: {readable(person.effective)}{person.reason ? ` (${readable(person.reason)})` : ""}{person.expires_at ? ` · expires ${readable(person.expires_at)}` : ""}</li>)}</ul>
        : <p className="text-sm text-slate-600">Nobody holds this competency yet.</p>}
        <p className="text-sm">{d.criteria ? `Independent qualification needs ${(d.criteria as { supervised_required: number }).supervised_required} supervised confirmation(s)${(d.criteria as { observed_trial_required: boolean }).observed_trial_required ? " and a retained observed trial" : ""}.` : "No qualification evidence is set yet."}</p>
        <p className="text-xs text-slate-600">Acknowledging a procedure does not grant competence, and changing an assignment does not create it.</p></Section>
      <div className="space-y-4">{action("capability.assess", { competency_id: row.id }, true)}{action("capability.criteria", { competency_id: row.id })}</div>
    </> : null}

    {view === "instruments" ? <>
      <Section title="Check evidence">{list<{ checked_on: string; valid_until: string; result: string; certificate_ref: string; note: string }>(d.checks).length
        ? <ul className="space-y-1 text-sm">{list<{ checked_on: string; valid_until: string; result: string; certificate_ref: string; note: string }>(d.checks).map((item, index) => <li key={index}>{readable(item.checked_on)} · {item.result} · valid until {readable(item.valid_until)} · {item.certificate_ref}</li>)}</ul>
        : <p className="text-sm text-slate-600">No check evidence. Results measured with this instrument are not traceable.</p>}</Section>
      {list<{ id: string; trigger: string; window_from: string | null; affected: unknown[]; status: string; review_note: string | null }>(d.reviews).length ? <Section title="Impact reviews">{list<{ id: string; trigger: string; window_from: string | null; affected: unknown[]; status: string; review_note: string | null }>(d.reviews).map(item => <div key={item.id} className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
        <p className="font-bold">{readable(item.trigger)} · {item.affected.length} result(s) since {item.window_from ? readable(item.window_from) : "first use"} · {item.status}</p>{item.review_note ? <p>{item.review_note}</p> : null}
        {item.status === "open" ? action("instrument.review", { id: item.id }, true) : null}</div>)}</Section> : null}
      {d.instrument_status === "active" ? <div className="space-y-4">{action("instrument.check", { instrument_id: row.id })}{action("instrument.bind", { instrument_id: row.id })}{action("instrument.withdraw", { instrument_id: row.id })}</div> : null}
    </> : null}

    {view === "capacity" ? <>
      <Section title="Affected press slots">{list<{ slot_id: string; job_number: string; order_number: string; running: boolean; starts_at: string; ends_at: string; shift: string; slot_status: string }>(d.affected).length
        ? list<{ slot_id: string; job_number: string; order_number: string; running: boolean; starts_at: string; ends_at: string; shift: string; slot_status: string }>(d.affected).map(slot => <div key={slot.slot_id} className="space-y-2 border-b border-slate-100 pb-3 last:border-0">
          <p className="text-sm"><span className="font-bold">{slot.job_number ?? "Job"}</span> · {slot.order_number} · {readable(slot.starts_at)} to {readable(slot.ends_at)} · {slot.running ? "running: record the interruption on the job" : readable(slot.slot_status)}</p>
          {!slot.running ? <>{action("capacity.move", { slot_id: slot.slot_id, unavailability_id: row.id }, false, `Replan ${slot.job_number ?? "slot"}`)}{action("capacity.unplan", { slot_id: slot.slot_id, unavailability_id: row.id }, false, `Return ${slot.job_number ?? "slot"} to planning`)}</> : null}</div>)
        : <p className="text-sm text-slate-600">No active slot overlaps this unavailability.</p>}
        {d.end_known === false ? <p className="text-xs text-amber-900">The end is not confirmed, so every later slot on this press is treated as affected until the machine is signed back into service.</p> : null}</Section>
      <Section title="Order promises">{list<{ order_id: string; order_number: string; expected_dispatch_date: string | null; decision: string | null; note: string | null }>(d.orders).length
        ? list<{ order_id: string; order_number: string; expected_dispatch_date: string | null; decision: string | null; note: string | null }>(d.orders).map(order => <div key={order.order_id} className="space-y-2 border-b border-slate-100 pb-3 last:border-0">
          <p className="text-sm"><Link className="font-bold underline" href={`/orders/${order.order_id}`}>{order.order_number}</Link> · promised {readable(order.expected_dispatch_date)} · {order.decision ? `${readable(order.decision)}: ${order.note}` : "not reviewed"}</p>
          {!order.decision ? action("capacity.review", { order_id: order.order_id, unavailability_id: row.id }, false, `Review ${order.order_number}`) : null}</div>)
        : <p className="text-sm text-slate-600">No order is affected.</p>}
        <p className="text-xs text-slate-600">No delivery date changes automatically. Commercial review is recorded per order.</p></Section>
    </> : null}

    {view === "counts" ? <>
      <Section title="Count lines">{list<{ id: string; label: string; unlisted: boolean; status: string; expected_pieces: number | null; expected_kg: number | null; review_note: string | null; observations: { round: number; pieces: number; kg: number | null; by: string }[]; adjustment: { before: Record<string, number>; after: Record<string, number> } | null }>(d.lines).map(line => <div key={line.id} className="space-y-2 border-b border-slate-100 pb-3 last:border-0">
        <p className="text-sm"><span className="font-bold">{line.label}</span> · {readable(line.status)}{line.expected_pieces !== null ? ` · expected ${line.expected_pieces} pcs / ${readable(line.expected_kg)} kg` : ""}</p>
        {line.observations.length ? <p className="text-xs text-slate-600">{line.observations.map(item => `Round ${item.round}: ${item.pieces} pcs${item.kg !== null ? ` / ${readable(item.kg)} kg` : ""} by ${item.by}`).join(" · ")}</p> : null}
        {line.adjustment ? <p className="text-xs text-slate-600">Adjusted from {line.adjustment.before.pieces} pcs / {readable(line.adjustment.before.kg)} kg to {line.adjustment.after.pieces} pcs / {readable(line.adjustment.after.kg)} kg</p> : null}
        {line.review_note ? <p className="text-xs text-slate-600">Review: {line.review_note}</p> : null}
        {d.count_status === "open" && ["pending", "recount"].includes(line.status) && !line.unlisted ? action("count.record", { count_id: row.id, line_id: line.id }, false, line.status === "recount" ? `Recount ${line.label}` : `Count ${line.label}`) : null}
        {d.count_status === "open" && ["difference", "moved", "unlisted", "pending"].includes(line.status) ? action("count.review", { line_id: line.id }, false, `Review ${line.label}`) : null}</div>)}</Section>
      {d.count_status === "open" ? <div className="space-y-4">{action("count.record", { count_id: row.id }, false, "Record an unlisted bundle")}{row.status === "ready_to_close" ? action("count.close", { count_id: row.id }, true) : null}</div> : null}
    </> : null}

    {view === "packs" ? <>
      <Section title="Readiness checklist">{list<{ key: string; kind: string; requirement_id?: string; label: string; mandatory: boolean; state: string; evidence: Record<string, unknown> | null; waiver: string | null }>(d.items).length
        ? list<{ key: string; kind: string; requirement_id?: string; label: string; mandatory: boolean; state: string; evidence: Record<string, unknown> | null; waiver: string | null }>(d.items).map(item => <div key={item.key} className="space-y-2 border-b border-slate-100 pb-3 last:border-0">
          <p className="text-sm"><span className="font-bold">{item.label}</span> · {readable(item.state)}{item.mandatory ? "" : " · advisory"}</p>
          {item.evidence ? <p className="break-words text-xs text-slate-600">{Object.entries(item.evidence).filter(([key]) => !key.endsWith("_id")).map(([key, value]) => `${key.replaceAll("_", " ")}: ${readable(value)}`).join(" · ")}</p> : null}
          {item.waiver ? <p className="text-xs text-amber-900">Authorized deviation: {item.waiver}</p> : null}
          {item.kind === "certificate" && item.state !== "satisfied" ? action("pack.link", { dispatch_id: row.id, requirement_id: item.requirement_id }, false, `Link evidence for ${item.label}`) : null}
          {!["satisfied", "deviation_authorized"].includes(item.state) ? action("pack.waive", { dispatch_id: row.id, requirement_key: item.key }, false, `Authorize a deviation for ${item.label}`) : null}</div>)
        : <p className="text-sm text-slate-600">No requirement applies to this dispatch.</p>}
        <p className="text-xs text-slate-600">An uploaded file satisfies a requirement only while the document is approved. Internal cost, margin and supplier rates are never part of a pack.</p></Section>
      {list<{ id: string; version: number; status: string; issued_at: string; withdraw_note: string | null }>(d.issues).length ? <Section title="Issued packs">{list<{ id: string; version: number; status: string; issued_at: string; withdraw_note: string | null }>(d.issues).map(issue => <div key={issue.id} className="space-y-2 text-sm">
        <p><span className="font-bold">Version {issue.version}</span> · {issue.status} · {readable(issue.issued_at)}{issue.withdraw_note ? ` · ${issue.withdraw_note}` : ""}</p>
        {issue.status === "issued" ? action("pack.withdraw", { id: issue.id }) : null}</div>)}</Section> : null}
      {d.ready ? action("pack.issue", { dispatch_id: row.id }, row.status !== "issued") : null}
    </> : null}

    {view === "returns" ? <>
      <Section title="Material received">{list<{ kg: number; status: string; disposition: string | null; received_at: string }>(d.receipts).length
        ? <ul className="space-y-1 text-sm">{list<{ kg: number; status: string; disposition: string | null; received_at: string }>(d.receipts).map((item, index) => <li key={index}>{readable(item.kg)} kg · {item.status}{item.disposition ? ` · ${readable(item.disposition)}` : ""} · {readable(item.received_at)}</li>)}</ul>
        : <p className="text-sm text-slate-600">Nothing received yet. Record the receipt through connected returns; returned material stays quarantined until QC releases it.</p>}
        {d.dispatch_id ? <Link href={`/dispatches/${String(d.dispatch_id)}`} className="inline-flex min-h-11 items-center text-sm font-bold underline">Open the dispatch to receive or inspect</Link> : null}</Section>
      <Section title="Resolution">{list<{ link_type: string; target_id: string; kg: number | null; at: string }>(d.links).length
        ? <ul className="space-y-1 text-sm">{list<{ link_type: string; target_id: string; kg: number | null; at: string }>(d.links).map(item => <li key={item.target_id}>{readable(item.link_type)} · {readable(item.kg)} kg · {readable(item.at)}</li>)}</ul>
        : <p className="text-sm text-slate-600">No credit or replacement linked yet. Approved response: {RETURN_RESPONSES[d.response as keyof typeof RETURN_RESPONSES] ?? readable(d.response)}.</p>}</Section>
      {row.status !== "closed" && row.status !== "rejected" ? <div className="space-y-4">
        {d.response === "credit" ? action("return.link", { id: row.id, link_type: "credit_note" }, false, "Link the credit note") : null}
        {["replacement", "rework_return"].includes(String(d.response)) ? <>{action("return.link", { id: row.id, link_type: "replacement_dispatch" }, false, "Link the replacement dispatch")}{action("return.link", { id: row.id, link_type: "replacement_job" }, false, "Link the replacement production job")}</> : null}
        {row.status === "ready_to_close" ? action("return.close", { id: row.id }, true) : null}
        {num(d.resolved_kg) === 0 && num(d.credited_kg) === 0 && num(d.replacement_dispatched_kg) === 0 ? action("return.reject", { id: row.id }) : null}
      </div> : null}
    </> : null}
  </div>;
}
