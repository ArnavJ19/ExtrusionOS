"use client";

import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LifecycleMutationForm, LIFECYCLE_ACTION_FORMS } from "./mutation-form";
import { JOURNEY_KINDS, LABEL_FIELDS, PROMISE_VERDICTS, SAMPLE_REASONS, canUseLifecycleAction, lifecycleStatusLabel, type LabelField, type LifecycleAction, type LifecycleDetail, type LifecycleView } from "@/lib/workflow/lifecycle";
import type { SessionContext } from "@/types/app";
import { formatDate } from "@/lib/utils/format";

const TITLES: Record<string, string> = {
  order_number: "Order", customer: "Customer", current_stage: "Order stage", ordered_kg: "Ordered (kg)", dispatched_kg: "Dispatched (kg)", outstanding_inr: "Outstanding receivable (INR)",
  blocking_count: "Items blocking closure", closure_kind: "Closure", closed_at: "Closed", closed_by: "Closed by", close_note: "Closure note", previous_stage: "Stage before closure",
  profile_code: "Profile", die_number: "Die", drawing_revision: "Drawing revision", drawing_state: "Drawing state", reason: "Reason", quantity_pieces: "Sample pieces", authority: "Approved by",
  gates_production: "Production waits for approval", response_days: "Response allowed (days)", iteration: "Sample number", measured: "Current sample measured", limit_kg: "Approved limit (kg)", waiting_jobs: "Jobs waiting",
  scope: "Applies to", target: "Target", revision: "Revision", instructions: "Instructions", max_bundle_kg: "Maximum net kg per bundle", max_pieces: "Maximum pieces per bundle", spacer_required: "Spacers required",
  wrapping: "Wrapping", created_by: "Written by", approved_by: "Approved by", approved_at: "Approved",
  bundle_number: "Bundle", pieces: "Pieces", net_kg: "Net (kg)", gross_kg: "Gross (kg)", dispatched: "Loaded for dispatch", packed_at: "Packed", template_scope: "Template applied", template_revision: "Template revision",
  verdict: "Result when proposed", expires_at: "Proposal expires", proposed_by: "Proposed by", accepted_by: "Accepted by", accepted_at: "Accepted", previous_expected_date: "Expected dispatch before acceptance",
  order_expected_date: "Order expected dispatch date", closed_note: "Closing note",
  start_type: "Started from", opened_by: "Opened by", opened_at: "Opened", conclusion: "Conclusion",
  kind: "Transformation", input_kg: "Input (kg)", output_kg: "Output (kg)", variance_kg: "Variance (kg)", variance_reason: "Variance reason", recorded_by: "Recorded by", recorded_at: "Recorded", reversed_at: "Reversed", reverse_note: "Reversal reason",
  participants: "People involved", baseline_from: "Baseline from", baseline_to: "Baseline to"
};

// Template limits left blank mean no limit, not missing data.
const UNSET: Record<string, string> = { max_bundle_kg: "No limit", max_pieces: "No limit", wrapping: "Not required" };

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
const record = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

function Facts({ details }: { details: Record<string, unknown> }) {
  const entries = Object.entries(details).filter(([key, value]) => TITLES[key] && (value === null || typeof value !== "object"));
  return entries.length ? <dl className="grid gap-4 sm:grid-cols-2">{entries.map(([key, value]) => <div key={key} className="min-w-0"><dt className="text-xs font-bold text-slate-500">{TITLES[key]}</dt><dd className="break-words text-sm text-slate-900">{value === null && UNSET[key] ? UNSET[key] : readable(value)}</dd></div>)}</dl> : null;
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4"><h2 className="font-bold">{title}</h2>{children}</section>;
}
function ActionDisclosure({ children, open }: { children: ReactElement<{ action: LifecycleAction; role: string; title?: string }>; open?: boolean }) {
  if (!canUseLifecycleAction(children.props.role, children.props.action)) return null;
  return <details open={open} className="rounded-2xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer py-2 text-sm font-bold text-slate-700">{children.props.title ?? LIFECYCLE_ACTION_FORMS[children.props.action].title}</summary><div className="mt-3">{children}</div></details>;
}

type ClosureItem = { key: string; domain: string; label: string; owner: string; href: string; detail: string; blocking: boolean; carriable: boolean; carried: boolean; carry_reason?: string };
type SampleEvent = { event: string; iteration: number; job_number: string | null; sample_tag: string | null; location: string | null; recipient: string | null; expected_response: string | null; customer_contact: string | null; limit_kg: number | null; evidence: string; by: string; role: string; at: string };
type Check = { date: string; kg: number; cumulative_kg: number; production_needed_kg: number; production_by: string; own_slots_kg: number; free_capacity_kg: number; claimed_by_others_kg: number; ok: boolean };
type TraceNode = { key: string; type: string; id: string; label: string; depth: number; direction: string };

/** The printed label shows only the business-safe payload bound when packing was confirmed. */
function PrintableLabel({ payload, print, revision }: { payload: Record<string, unknown>; print: number; revision: number }) {
  return <>
    <style>{"@media print { body * { visibility: hidden !important; } #lifecycle-label, #lifecycle-label * { visibility: visible !important; } #lifecycle-label { position: absolute; inset: 0 auto auto 0; width: 100mm; border: 2px solid #000; } }"}</style>
    <div id="lifecycle-label" className="max-w-sm space-y-1 rounded-xl border-2 border-slate-900 bg-white p-4 text-sm text-slate-950">
      {Object.entries(payload).map(([key, value]) => <p key={key} className="flex justify-between gap-3"><span className="font-semibold">{LABEL_FIELDS[key as LabelField] ?? key}</span><span className="break-all text-right">{String(value)}</span></p>)}
      <p className="pt-2 text-xs text-slate-600">Print {print} · template revision {revision}</p>
    </div>
    <Button type="button" variant="secondary" onClick={() => window.print()}>Print label</Button>
  </>;
}

export function LifecycleRecord({ view, detail, context }: { view: LifecycleView; detail: LifecycleDetail; context: SessionContext }) {
  const { row } = detail; const d = row.details; const role = context.role;
  const action = (name: LifecycleAction, fixed: Record<string, unknown>, open = false, title?: string) => <ActionDisclosure open={open}><LifecycleMutationForm action={name} role={role} fixed={fixed} title={title} /></ActionDisclosure>;
  return <div className="space-y-5">
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="break-words text-xl font-bold">{row.label}</h2><Badge value={row.status} /></div>
      <p className="text-sm font-semibold text-slate-800">{lifecycleStatusLabel(row.status)}</p>
      <p className="break-words text-sm text-slate-700">{row.summary}</p>
      {row.owner || row.due_date ? <p className="text-sm font-semibold">{row.owner ?? "Not assigned"}{row.due_date ? ` · ${formatDate(row.due_date)}` : ""}</p> : null}
      {row.source_href ? <Link href={row.source_href} className="inline-flex min-h-11 items-center text-sm font-bold underline">Open the source workflow</Link> : null}
      <Facts details={d} />
      <p className="text-xs text-slate-500">Current authorized read as of {readable(detail.as_of)}. Every action rechecks current sources before it is recorded.</p>
    </section>

    {view === "closure" ? <>
      <Section title={d.closure_kind ? "Reviewed snapshot at closure" : "What is still open"}>{list<ClosureItem>(d.items).length
        ? <ul className="space-y-3">{list<ClosureItem>(d.items).map(item => <li key={item.key} className="space-y-1 rounded-xl bg-slate-50 p-3 text-sm">
          <p className="font-bold">{item.label} · {item.carried ? "carried" : item.blocking ? "blocks closure" : "does not block"}</p>
          <p className="break-words">{item.detail}</p>{item.carry_reason ? <p className="text-xs text-amber-900">Carried: {item.carry_reason}</p> : null}
          <p className="text-xs text-slate-500">Owner: {readable(item.owner)} · <Link href={item.href} className="font-semibold underline">Resolve in its workflow</Link></p>
          {!d.closure_kind && item.carriable && !item.carried ? action("closure.carry", { order_id: d.order_id, item_key: item.key }, false, `Carry “${item.label}” with a reason`) : null}</li>)}</ul>
        : <p className="text-sm text-slate-600">Nothing is open. Fulfilment, billing and returns reconcile.</p>}
        <p className="text-xs text-slate-600">Operational closure keeps receivables in accounts. Final closure needs a zero balance. A closed order accepts no new jobs, dispatches, reservations, finishing or packed bundles until reopened.</p></Section>
      {list<{ kind: string; status: string; closed_at: string; reopened_at: string | null; reopen_note: string | null }>(d.history).length ? <Section title="Closure history"><ul className="space-y-1 text-sm">{list<{ kind: string; status: string; closed_at: string; reopened_at: string | null; reopen_note: string | null }>(d.history).map(item => <li key={item.closed_at}>{readable(item.kind)} closure {readable(item.closed_at)}{item.reopened_at ? ` · reopened ${readable(item.reopened_at)}: ${item.reopen_note}` : ""}</li>)}</ul></Section> : null}
      {d.closure_kind ? action("closure.reopen", { order_id: d.order_id }) : row.status === "ready" ? action("closure.close", { order_id: d.order_id }, true) : null}
    </> : null}

    {view === "samples" ? <>
      <Section title="Sample history">{list<SampleEvent>(d.events).length
        ? <ol className="space-y-3">{list<SampleEvent>(d.events).map((event, index) => <li key={index} className="border-l-2 border-slate-200 pl-3 text-sm">
          <p className="font-bold">Sample {event.iteration} · {readable(event.event)}{event.customer_contact ? ` · ${event.customer_contact}` : ""}{event.limit_kg ? ` · up to ${readable(event.limit_kg)} kg` : ""}</p>
          <p className="break-words">{[event.job_number && `job ${event.job_number}`, event.sample_tag && `tag ${event.sample_tag}`, event.location, event.recipient && `sent to ${event.recipient}`, event.expected_response && `decision by ${readable(event.expected_response)}`].filter(Boolean).join(" · ")}</p>
          <p className="break-words">{event.evidence}</p><p className="text-xs text-slate-500">{event.by} ({readable(event.role)}) · {readable(event.at)}</p></li>)}</ol>
        : <p className="text-sm text-slate-600">No sample produced yet.</p>}
        <p className="text-xs text-slate-600">Reason: {SAMPLE_REASONS[d.reason as keyof typeof SAMPLE_REASONS] ?? readable(d.reason)}. Approval proves the sample, not the batch. Jobs already started are not stopped.</p></Section>
      {row.status !== "withdrawn" ? <div className="space-y-4">
        {["required", "rejected", "lost", "renewal_needed", "clarification"].includes(row.status) ? action("sample.record", { id: row.id, event: "produced" }, true, "Record a produced sample") : null}
        {["produced", "measured"].includes(row.status) ? action("sample.record", { id: row.id, event: "measured" }, row.status === "produced", "Record measurements") : null}
        {(row.status === "measured" || row.status === "clarification") && d.measured ? action("sample.record", { id: row.id, event: "sent" }, true, "Send for decision") : null}
        {["produced", "measured", "sent", "response_overdue"].includes(row.status) ? action("sample.record", { id: row.id, event: "lost" }, false, "Record the sample as lost") : null}
        {["sent", "response_overdue"].includes(row.status) ? action("sample.decide", { id: row.id }, true) : null}
        {["approved", "conditional"].includes(row.status) ? action("sample.invalidate", { id: row.id }) : null}
        {action("sample.withdraw", { id: row.id })}
      </div> : null}
    </> : null}

    {view === "templates" ? <>
      <Section title="Label fields"><p className="text-sm">{list<string>(d.label_fields).map(key => LABEL_FIELDS[key as LabelField] ?? key).join(", ")}</p>
        <p className="text-xs text-slate-600">A second person approves each revision. Labels printed on an earlier revision are listed for reprinting.</p></Section>
      {row.status === "draft" && d.created_by_id !== context.userId ? action("template.approve", { id: row.id }, true) : null}
      {row.status === "draft" && d.created_by_id === context.userId ? <p className="rounded-xl bg-slate-50 p-3 text-sm">You wrote this revision. Another authorized person approves it.</p> : null}
    </> : null}

    {view === "labels" ? <>
      {!d.template_id || list<string>(d.missing).length || list<string>(d.overflow).length ? <Section title="Before this bundle can be labelled">
        {!d.template_id ? <p className="text-sm">No approved packing template applies to this order. Create and approve one for the company, customer, project or order.</p> : null}
        {list<string>(d.missing).length ? <p className="text-sm text-amber-900">Facts not recorded: {list<string>(d.missing).map(key => LABEL_FIELDS[key as LabelField] ?? key).join(", ")}. Record them in the order or profile.</p> : null}
        {list<string>(d.overflow).length ? <p className="text-sm text-amber-900">Too long for a label line: {list<string>(d.overflow).map(key => LABEL_FIELDS[key as LabelField] ?? key).join(", ")}.</p> : null}</Section> : null}
      {d.active_print ? <Section title={`Label (print ${String(record(d.active_print).print_number)})`}>
        <PrintableLabel payload={record(record(d.active_print).payload)} print={Number(record(d.active_print).print_number)} revision={Number(record(d.active_print).template_revision)} />
        {record(d.active_print).deviation ? <p className="text-sm text-amber-900">Packing deviation: {String(record(d.active_print).deviation)}</p> : null}
      </Section> : d.template_id ? <Section title="Label preview"><dl className="grid gap-2 text-sm sm:grid-cols-2">{Object.entries(record(d.preview)).map(([key, value]) => <div key={key}><dt className="text-xs font-bold text-slate-500">{LABEL_FIELDS[key as LabelField] ?? key}</dt><dd className="break-words">{String(value)}</dd></div>)}</dl>
        <p className="text-xs text-slate-600">The label prints after packing is confirmed against the template.</p></Section> : null}
      {list<{ print_number: number; reason: string; status: string; template_revision: number; by: string; at: string }>(d.prints).length ? <Section title="Print history"><ul className="space-y-1 text-sm">{list<{ print_number: number; reason: string; status: string; template_revision: number; by: string; at: string }>(d.prints).map(item => <li key={item.print_number}>Print {item.print_number} · {readable(item.reason)} · revision {item.template_revision} · {item.status} · {item.by} · {readable(item.at)}</li>)}</ul></Section> : null}
      {row.status === "to_label" && !d.dispatched ? action("label.pack", { bundle_id: row.id }, true) : null}
      {["labelled", "relabel_needed"].includes(row.status) ? action("label.reprint", { bundle_id: row.id }, row.status === "relabel_needed", row.status === "relabel_needed" ? "Reprint on the current template" : undefined) : null}
    </> : null}

    {view === "promises" ? (() => {
      const evaluation = record(d.current ?? d.evaluation);
      return <>
        <Section title={d.current ? "Current capacity check" : "Check when proposed"}>
          <p className="text-sm font-semibold">{PROMISE_VERDICTS[String(evaluation.verdict)] ?? readable(evaluation.verdict)}</p>
          {list<string>(evaluation.reasons).length ? <ul className="list-disc space-y-1 pl-5 text-sm text-amber-950">{list<string>(evaluation.reasons).map(reason => <li key={reason}>{reason}</li>)}</ul> : null}
          <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b"><th scope="col" className="py-2 pr-3">Date</th><th scope="col" className="py-2 pr-3">Kg</th><th scope="col" className="py-2 pr-3">Produce by</th><th scope="col" className="py-2 pr-3">Needed</th><th scope="col" className="py-2 pr-3">Covered</th><th scope="col" className="py-2">Result</th></tr></thead>
            <tbody>{list<Check>(evaluation.checks).map(check => <tr key={check.date} className="border-b last:border-0"><td className="py-2 pr-3">{readable(check.date)}</td><td className="py-2 pr-3">{readable(check.kg)}</td><td className="py-2 pr-3">{readable(check.production_by)}</td>
              <td className="py-2 pr-3">{readable(check.production_needed_kg)}</td><td className="py-2 pr-3">{readable(Number(check.own_slots_kg) + Number(check.free_capacity_kg))}</td><td className="py-2 font-semibold">{check.ok ? "Covered" : "Not covered"}</td></tr>)}</tbody></table></div>
          {evaluation.earliest_full_date ? <p className="text-sm">Earliest full delivery on current capacity: {readable(evaluation.earliest_full_date)}</p> : null}
          <details className="text-sm"><summary className="cursor-pointer py-2 font-semibold">Assumptions</summary><ul className="list-disc space-y-1 pl-5">{list<string>(evaluation.assumptions).map(item => <li key={item}>{item}</li>)}</ul></details>
        </Section>
        {row.status === "proposed" ? action("promise.accept", { id: row.id }, true) : null}
        {["proposed", "accepted", "promise_at_risk"].includes(row.status) ? action("promise.withdraw", { id: row.id }) : null}
      </>;
    })() : null}

    {view === "trace" ? (() => {
      const snapshot = record(d.snapshot); const nodes = list<TraceNode>(snapshot.nodes);
      const group = (direction: string) => nodes.filter(node => node.direction === direction).sort((a, b) => a.depth - b.depth);
      const open = row.status === "open"; const held = new Set(list<{ stock_batch_id: string }>(d.holds).map(item => item.stock_batch_id));
      const node = (item: TraceNode) => <li key={item.key} className="space-y-1 text-sm"><p style={{ paddingLeft: `${Math.min(item.depth, 8) * 8}px` }} className="break-words">{item.label}</p>
        {open && item.type === "stock_batch" && !held.has(item.id) ? action("trace.hold", { id: row.id, stock_batch_id: item.id }, false, `Hold ${item.label}`) : null}</li>;
      return <>
        <Section title="Sources (backward)">{group("backward").length ? <ul className="space-y-2">{group("backward").map(node)}</ul> : <p className="text-sm text-slate-600">No recorded source.</p>}
          {list<{ key: string; label: string; note: string }>(snapshot.unknown).map(item => <p key={item.key} className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{item.label}: {item.note}</p>)}</Section>
        <Section title="Where it went (forward)">{group("forward").length ? <ul className="space-y-2">{group("forward").map(node)}</ul> : <p className="text-sm text-slate-600">No recorded downstream use.</p>}
          {snapshot.truncated ? <p className="text-sm text-amber-900">The graph reached its 200-record limit. Start a narrower investigation for the rest.</p> : null}
          <p className="text-xs text-slate-600">Only recorded identities are followed. Similar dates or codes are never matched.</p></Section>
        {list<{ stock_batch_id: string; label: string; previous_qc_status: string; current_qc_status: string }>(d.holds).length ? <Section title="Stock on hold"><ul className="space-y-1 text-sm">{list<{ stock_batch_id: string; label: string; previous_qc_status: string; current_qc_status: string }>(d.holds).map(item => <li key={item.stock_batch_id}>{item.label} · was {readable(item.previous_qc_status)}, now {readable(item.current_qc_status)}</li>)}</ul>
          <p className="text-xs text-slate-600">Quality releases or disposes held stock through the stock workflow.</p></Section> : null}
        {open ? action("trace.close", { id: row.id }) : null}
      </>;
    })() : null}

    {view === "bundles" ? <>
      <Section title="Bundles in and out">{list<{ direction: string; stock_batch_id: string; bundle_number: string | null; pieces: number; kg: number; current_status: string; current_pieces: number; current_kg: number }>(d.lines).map(line => <p key={line.stock_batch_id} className="break-words text-sm">
        <span className="font-bold">{line.direction === "input" ? "In" : "Out"}: {line.bundle_number ?? "untagged"}</span> · {line.pieces} pcs · {readable(line.kg)} kg · now {readable(line.current_status)}</p>)}</Section>
      {row.status === "completed" ? action("bundle.reverse", { id: row.id }) : null}
    </> : null}

    {view === "journeys" ? (() => {
      const timeline = record(d.timeline); const measures = list<{ phase: string; metric: string; value: number; unit: string; sample_size: number; limitations: string }>(d.measures);
      const metrics = [...new Set(measures.map(item => item.metric))];
      const open = row.status !== "closed"; const reviewOwner = d.owner_id === context.userId;
      return <>
        <Section title="Recorded journey">{list<{ kind: string; label: string; at: string; hours_since_previous: number | null }>(timeline.events).length
          ? <ol className="space-y-2">{list<{ kind: string; label: string; at: string; hours_since_previous: number | null }>(timeline.events).map((event, index) => <li key={index} className="border-l-2 border-slate-200 pl-3 text-sm"><p className="font-semibold">{event.label}</p><p className="text-xs text-slate-500">{readable(event.at)}{event.hours_since_previous !== null ? ` · ${readable(event.hours_since_previous)} h after the previous step` : ""}</p></li>)}</ol>
          : <p className="text-sm text-slate-600">No recorded events.</p>}
          {list<string>(timeline.missing).length ? <ul className="list-disc space-y-1 pl-5 text-sm text-amber-950">{list<string>(timeline.missing).map(item => <li key={item}>{item}</li>)}</ul> : null}</Section>
        <Section title="Observations">{list<{ kind: string; minutes: number | null; private: boolean; observation: string; by: string; at: string }>(d.annotations).length
          ? <ul className="space-y-2">{list<{ kind: string; minutes: number | null; private: boolean; observation: string; by: string; at: string }>(d.annotations).map((item, index) => <li key={index} className="rounded-xl bg-slate-50 p-3 text-sm">
            <p className="font-semibold">{JOURNEY_KINDS[item.kind as keyof typeof JOURNEY_KINDS] ?? readable(item.kind)}{item.minutes ? ` · ${item.minutes} min` : ""}{item.private ? " · private" : ""}</p><p className="break-words">{item.observation}</p><p className="text-xs text-slate-500">{item.by} · {readable(item.at)}</p></li>)}</ul>
          : <p className="text-sm text-slate-600">No observations you can see yet.</p>}
          {open ? action("journey.annotate", { id: row.id }) : null}</Section>
        <Section title="Improvement actions">{list<{ id: string; finding: string; owner: string; owner_id: string; due_date: string; status: string }>(d.actions).length
          ? list<{ id: string; finding: string; owner: string; owner_id: string; due_date: string; status: string }>(d.actions).map(item => <div key={item.id} className="space-y-2 border-b border-slate-100 pb-3 last:border-0">
            <p className="break-words text-sm"><span className="font-bold">{item.finding}</span> · {item.owner} · due {readable(item.due_date)} · {readable(item.status)}</p>
            {open && ["open", "trial"].includes(item.status) && (item.owner_id === context.userId || reviewOwner || ["owner", "admin", "factory_manager"].includes(role)) ? action("journey.progress", { action_id: item.id }, false, "Update this action") : null}</div>)
          : <p className="text-sm text-slate-600">No actions assigned.</p>}
          {open ? action("journey.action", { id: row.id }) : null}</Section>
        <Section title="Baseline and trial">{metrics.length ? <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b"><th scope="col" className="py-2 pr-3">Metric</th><th scope="col" className="py-2 pr-3">Baseline</th><th scope="col" className="py-2">Trial</th></tr></thead>
          <tbody>{metrics.map(metric => { const cell = (phase: string) => { const item = measures.find(m => m.metric === metric && m.phase === phase); return item ? `${readable(item.value)} ${item.unit} (n=${item.sample_size}; ${item.limitations})` : "Not recorded"; };
            return <tr key={metric} className="border-b last:border-0"><td className="py-2 pr-3 font-semibold">{readable(metric)}</td><td className="py-2 pr-3">{cell("baseline")}</td><td className="py-2">{cell("trial")}</td></tr>; })}</tbody></table></div>
          : <p className="text-sm text-slate-600">No measures recorded.</p>}
          <p className="text-xs text-slate-600">A comparison of a few orders shows a direction, not proof of improvement. Limitations are stated with each value.</p>
          {open ? action("journey.measure", { id: row.id }) : null}</Section>
        {open ? action("journey.close", { id: row.id }) : null}
      </>;
    })() : null}
  </div>;
}
