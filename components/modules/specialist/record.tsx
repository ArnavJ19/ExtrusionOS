"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SpecialistMutationForm, SPECIALIST_ACTION_FORMS } from "./mutation-form";
import { canUseSpecialistAction, specialistStatusLabel, type SpecialistAction, type SpecialistDetail, type SpecialistView } from "@/lib/workflow/specialist";
import type { SessionContext } from "@/types/app";
import { formatDate } from "@/lib/utils/format";

const MONEY = (value: unknown) => (value === null || value === undefined || value === "" ? "Not recorded" : `INR ${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const KG = (value: unknown) => (value === null || value === undefined || value === "" ? "Not recorded" : `${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg`);
function readable(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString("en-IN", { maximumFractionDigits: 3 });
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return `${new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} IST`;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) return Number(value).toLocaleString("en-IN", { maximumFractionDigits: 4 });
  return String(value).replaceAll("_", " ");
}
const list = <T,>(value: unknown) => (Array.isArray(value) ? value as T[] : []);
const record = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

function Facts({ entries }: { entries: [string, unknown][] }) {
  return <dl className="grid gap-4 sm:grid-cols-2">{entries.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs font-bold text-slate-500">{label}</dt><dd className="break-words text-sm text-slate-900">{readable(value)}</dd></div>)}</dl>;
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"><h2 className="font-bold">{title}</h2>{children}</section>;
}
function Table({ columns, rows }: { columns: string[]; rows: ReactNode[][] }) {
  if (!rows.length) return <p className="text-sm text-slate-600">Nothing recorded.</p>;
  return <div className="overflow-x-auto"><table className="industrial-table min-w-full"><thead><tr>{columns.map(column => <th key={column} scope="col" className="whitespace-nowrap">{column}</th>)}</tr></thead>
    <tbody>{rows.map((cells, index) => <tr key={index}>{cells.map((cell, position) => <td key={position} className="align-top">{cell}</td>)}</tr>)}</tbody></table></div>;
}
function Notes({ items, tone = "amber" }: { items: string[]; tone?: "amber" | "slate" }) {
  if (!items.length) return null;
  return <ul className={`space-y-2 rounded-xl border p-3 text-sm ${tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-950" : "border-slate-200 bg-slate-50 text-slate-800"}`}>{items.map(item => <li key={item}>{item}</li>)}</ul>;
}

type Command = { action: SpecialistAction; label: string; fixed?: Record<string, unknown>; initial?: Record<string, string>; fixedRows?: boolean };

export function SpecialistRecord({ view, detail, context }: { view: SpecialistView; detail: SpecialistDetail; context: SessionContext }) {
  const row = detail.row; const d = row.details;
  const [open, setOpen] = useState<Command | null>(null);
  const commands: Command[] = [];
  const add = (command: Command) => { if (canUseSpecialistAction(context.role, command.action)) commands.push(command); };
  const inline = (command: Command, text: string) => canUseSpecialistAction(context.role, command.action) ? <Button type="button" variant="secondary" onClick={() => setOpen(command)}>{text}</Button> : "";
  let body: ReactNode = null;

  if (view === "intake") {
    const status = String(d.intake_status); const lines = list<Record<string, unknown>>(d.lines); const cmp = record(d.comparison);
    if (status === "review") add({ action: "intake.ready", label: "Mark ready for order entry", fixed: { id: row.id } });
    if (status === "ready") add({ action: "intake.link", label: "Link the order entered", fixed: { id: row.id } });
    if (["review", "ready"].includes(status)) add({ action: "intake.discard", label: "Discard", fixed: { id: row.id } });
    body = <><Section title="Purchase order"><Facts entries={[["Customer", d.customer], ["Customer purchase order", d.customer_po_ref], ["Purchase order date", d.po_date], ["Compared with", d.quote_number ?? "No quotation"], ["Amends", d.amends],
      ["Order", d.order_number], ["Submitted by", d.created_by], ["Submitted", d.created_at], ["Checksum", String(d.checksum ?? "").slice(0, 16)]]} />
      <Notes tone="slate" items={["Values are proposed from the text only where a line states them plainly. Nothing in the text is acted on, and a draft is never an accepted order."]} />
      {status === "ready" ? <Link href="/orders/new" className="inline-flex min-h-11 items-center text-sm font-bold underline">Open order entry</Link> : null}</Section>
      <Section title="Lines found in the document"><Table columns={["Line", "Text", "Profile", "Quantity", "Length", "Finish", "Date", "Rate", "State", ""]} rows={lines.map(line => [String(line.source_line), <span key="t" className="break-words font-mono text-xs">{String(line.raw_text)}</span>,
        readable(line.profile_code), line.quantity == null ? "Not read" : `${readable(line.quantity)} ${line.quantity_unit}`, line.length_mm ? `${line.length_mm} mm` : "", readable(line.finish), readable(line.due_date), line.rate_per_kg ? `${MONEY(line.rate_per_kg)}/kg` : "",
        <span key="s">{String(line.state).replaceAll("_", " ")}{list<string>(line.issues).length ? <span className="block text-xs text-amber-900">{list<string>(line.issues).join(" ")}</span> : null}{line.match_basis ? <span className="block text-xs text-slate-500">by {String(line.match_basis).replaceAll("_", " ")}</span> : null}</span>,
        status === "review" && line.state !== "not_a_line" ? inline({ action: "intake.resolve", label: `Resolve line ${line.source_line}`, fixed: { line_id: line.id }, initial: { decision: "line" } }, "Resolve") : ""])} /></Section>
      {cmp.quote ? <Section title={`Differences from quotation ${cmp.quote}`}><Table columns={["Line", "Profile", "Differences"]} rows={list<Record<string, unknown>>(cmp.lines).map(line => [String(line.seq), String(line.profile_code), list<string>(line.differences).join("; ") || "None"])} />
        {cmp.quoted_not_ordered ? <Notes items={[`Quoted but not in the purchase order: ${cmp.quoted_not_ordered}`]} /> : null}</Section> : null}
      <Section title="Document as submitted"><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-3 font-mono text-xs">{String(d.source_text ?? "")}</pre></Section></>;
  } else if (view === "automation") {
    if (d.kind === "rule") {
      const status = String(d.rule_status); const mine = d.created_by_id === context.userId; const cands = record(d.candidates);
      if (status === "draft" && !mine) add({ action: "automation.approve", label: "Approve this rule", fixed: { id: row.id } });
      if (status !== "retired") add({ action: "automation.simulate", label: "Simulate now", fixed: { id: row.id } });
      if (status === "approved") { add({ action: "automation.execute", label: "Run the rule", fixed: { id: row.id } }); add({ action: "automation.state", label: "Pause", fixed: { id: row.id, state: "paused" } }); }
      if (status === "paused") add({ action: "automation.state", label: "Resume", fixed: { id: row.id, state: "approved" } });
      if (status !== "retired") add({ action: "automation.state", label: "Retire", fixed: { id: row.id, state: "retired" } });
      body = <><Section title="Rule"><Facts entries={[["Code and version", `${d.rule_code} v${d.version}`], ["When", d.trigger_kind], ["Days", d.min_days], ["Minimum balance", d.min_amount === null ? "None" : MONEY(d.min_amount)], ["Action", `Create a ${d.task_priority} internal task`],
        ["Assigned to", d.assign_to ?? "Unassigned"], ["Task due in days", d.due_in_days], ["Defined by", d.created_by], ["Approved by", d.approved_by], ["Status", specialistStatusLabel(status, "automation")]]} />
        {status === "draft" && mine ? <Notes tone="slate" items={["A second person approves this rule. The person who defined it cannot."]} /> : null}
        {d.assign_active === false ? <Notes items={["The assigned employee is no longer active. Runs skip each record until the rule is revised."]} /> : null}
        <Notes tone="slate" items={["Only internal tasks are created. Nothing is sent to customers or suppliers. A simulation never creates a task, and each record gets at most one task from this rule."]} /></Section>
        <Section title="Records that qualify now"><p className="text-sm">{readable(cands.count)} record(s)</p><ul className="list-disc space-y-1 pl-5 text-sm">{list<string>(cands.sample).map(item => <li key={item} className="break-words">{item}</li>)}</ul></Section>
        <Section title="Recent runs and simulations"><Table columns={["When", "Kind", "Version", "Due", "Created", "Skipped", "Failed", "Simulated", "Left"]} rows={list<Record<string, unknown>>(d.executions).map(ex => [readable(ex.started_at),
          ex.mode === "simulation" ? "Simulation (nothing executed)" : "Execution", `v${ex.version}`, readable(ex.candidates), readable(ex.succeeded), readable(ex.skipped), readable(ex.failed), readable(ex.simulated), readable(ex.unprocessed)])} /></Section></>;
    } else {
      const simulation = d.mode === "simulation";
      body = <><Section title={simulation ? "Simulation" : "Execution"}>{simulation ? <Notes items={["Simulation only. Nothing was executed and no task was created."]} /> : null}
        <Facts entries={[["Rule", `${d.rule_code} v${d.rule_version}`], ["Started", d.started_at], ["Started by", d.started_by], ["Records due", d.candidates], ["Tasks created", d.succeeded], ["Skipped", d.skipped], ["Failed", d.failed], ["Would create", d.simulated], ["Left for the next run", d.unprocessed]]} />
        <Link href={`/tasks/specialist/automation/${d.rule_id}`} className="inline-flex min-h-11 items-center text-sm font-bold underline">Open the rule</Link></Section>
        <Section title="Outcome for each record"><Table columns={["Record", "Outcome", "Reason or task"]} rows={list<Record<string, unknown>>(d.effects).map(ef => [<span key="l" className="break-words">{String(ef.source_label)}</span>, String(ef.outcome),
          ef.task_id ? <Link key="t" href={`/tasks/${ef.task_id}`} className="font-semibold underline">Open task</Link> : readable(ef.reason)])} /></Section></>;
    }
  } else if (view === "lab") {
    const status = String(d.request_status); const tests = list<Record<string, unknown>>(d.tests); const results = list<Record<string, unknown>>(d.results);
    if (status === "requested") add({ action: "lab.custody", label: "Record dispatch", fixed: { id: row.id, stage: "dispatched" } });
    if (status === "dispatched") add({ action: "lab.custody", label: "Record laboratory acknowledgement", fixed: { id: row.id, stage: "received" } });
    if (["at_lab", "partial", "reported", "reviewed"].includes(status)) add({ action: "lab.result", label: "Record a result", fixed: { id: row.id } });
    if (["requested", "dispatched", "at_lab", "partial"].includes(status)) { add({ action: "lab.revise", label: "Record a revised date", fixed: { id: row.id } }); add({ action: "lab.stop", label: "Lost or cancelled", fixed: { id: row.id } }); }
    if (status === "reported") add({ action: "lab.review", label: "Record the quality decision", fixed: { id: row.id } });
    const order = record(d.affected_order);
    body = <><Section title="Request"><Facts entries={[["Sample", d.sample_ref], ["Material", d.job_number ? `Job ${d.job_number}` : d.billet_batch ? `Billet batch ${d.billet_batch}` : d.material_note], ["Laboratory", d.lab], ["Promised", d.promised_date],
      ["Revised date", d.revised_date ?? "Not revised"], ["Estimated charge", d.estimated_charge === null ? "Not stated" : MONEY(d.estimated_charge)], ["Dispatched", d.dispatched_at], ["Consignment", d.dispatch_ref], ["Laboratory acknowledged", d.lab_received_at],
      ["Retest of", d.retest_of], ["Order waiting", order.order_number ? `${order.order_number} (${readable(order.stage)}, due ${readable(order.expected_dispatch_date)})` : "None traced"]]} />
      {row.status === "overdue" ? <Notes items={["The promised date has passed without every result."]} /> : null}</Section>
      <Section title="Laboratory statements"><p className="text-xs text-slate-600">These are the laboratory&apos;s statements. They never release material by themselves; amended results are added as new revisions.</p>
        <Table columns={["Test", "Method", "Revision", "Statement", "Laboratory outcome", "Report", "Recorded"]} rows={tests.flatMap(test => { const own = results.filter(r => r.test_code === test.code);
          return own.length ? own.map(r => [String(test.code), String(test.method), `${r.revision}${r.current ? " (current)" : " (superseded)"}`, String(r.statement), String(r.lab_outcome).replaceAll("_", " "), String(r.report_ref), readable(r.recorded_at)])
            : [[String(test.code), String(test.method), "", "Awaiting result", "", "", ""]]; })} /></Section>
      <Section title="Quality decision"><Facts entries={[["Decision", d.decision ?? "Not decided"], ["Reason", d.decision_note], ["Decided", d.decided_at]]} />
        {list<Record<string, unknown>>(d.decision_history).length ? <Table columns={["Earlier decision", "Reason", "Reopened"]} rows={list<Record<string, unknown>>(d.decision_history).map(h => [String(h.decision), readable(h.note), readable(h.reopened_at)])} /> : null}</Section></>;
  } else if (view === "shades") {
    if (d.kind === "reference") {
      const status = String(d.reference_status); const mine = d.created_by_id === context.userId;
      if (status === "draft" && !mine) add({ action: "shade.approve", label: "Approve this reference", fixed: { id: row.id } });
      if (status === "approved") { add({ action: "shade.withdraw", label: "Withdraw", fixed: { id: row.id } }); add({ action: "shade.bind", label: "Bind to an order line", fixed: { reference_id: row.id } }); }
      body = <><Section title="Reference"><Facts entries={[["Code and revision", `${d.ref_code} rev ${d.revision}`], ["Shade", d.shade_name], ["Finish", d.finish_type], ["Specification", d.specification], ["Customer", d.customer ?? "Any customer"], ["Project", d.project_ref],
        ["Physical sample", d.sample_location], ["Assessed under", d.assessment_conditions], ["Defined by", d.created_by], ["Approved by", d.approved_by]]} />
        {status === "draft" && mine ? <Notes tone="slate" items={["A second person approves this reference. The person who defined it cannot."]} /> : null}
        <Notes tone="slate" items={["A photograph can support identification but is not a calibrated colour measurement. A later revision never rewrites earlier approvals."]} /></Section>
        <Section title="Order lines bound to this revision"><Table columns={["Order", "Line", "Status"]} rows={list<Record<string, unknown>>(d.bindings).map(b => [String(b.order_number), readable(b.line), specialistStatusLabel(String(b.status), "shades")])} /></Section></>;
    } else {
      if (d.binding_status === "active") add({ action: "shade.decide", label: "Record a batch decision", fixed: { id: row.id } });
      add({ action: "shade.bind", label: "Rebind the line", fixed: { order_item_id: d.order_item_id } });
      body = <><Section title="Bound order line"><Facts entries={[["Order", d.order_number], ["Customer", d.customer], ["Line", d.line], ["Line finish", d.line_finish], ["Reference", `${d.ref_code} rev ${d.revision} (${readable(d.reference_status)})`], ["Shade", d.shade_name],
        ["Specification", d.specification], ["Physical sample", d.sample_location], ["Agreed conditions", d.assessment_conditions]]} />
        <Notes items={list<string>(d.flags)} /></Section>
        <Section title="Batch decisions"><Table columns={["Batch", "Decision", "Assessed under", "Status", "When", "Reason"]} rows={list<Record<string, unknown>>(d.decisions).map(x => [String(x.batch_label), String(x.decision).replaceAll("_", " "), String(x.assessed_under), String(x.status), readable(x.decided_at), String(x.note)])} /></Section>
        <Section title="Finishing jobs of this order"><Table columns={["Status", "Shade on the job", "Sent", "Received"]} rows={list<Record<string, unknown>>(d.finishing_jobs).map(j => [readable(j.status), readable(j.shade_name ?? j.color_code), readable(j.sent_date), readable(j.received_date)])} /></Section></>;
    }
  } else if (view === "agreements") {
    const status = String(d.agreement_status); const mine = d.created_by_id === context.userId; const releases = list<Record<string, unknown>>(d.releases);
    if (status === "draft" && !mine) add({ action: "agreement.approve", label: "Approve this agreement", fixed: { id: row.id } });
    if (status === "active") add({ action: "agreement.close", label: "Close or carry forward", fixed: { id: row.id } });
    body = <><Section title="Agreement"><Facts entries={[["Customer", d.customer], ["Customer reference", d.customer_ref], ["Valid from", d.valid_from], ["Valid until", d.valid_to], ["Agreed overrun", `${readable(d.overrun_percent)}%`], ["Carried from", d.carried_from], ["Carried to", d.carried_to], ["Close note", d.close_note]]} />
      {status === "draft" && mine ? <Notes tone="slate" items={["A second person approves this agreement. The person who defined it cannot."]} /> : null}
      <Notes tone="slate" items={["The agreement balance is a commercial ceiling. It is not stock and not production demand."]} /></Section>
      <Section title="Lines, balance and rates"><Table columns={["Line", "Profile", "Finish", "Agreed", "Released", "Available", "Rate today", ""]} rows={list<Record<string, unknown>>(d.lines).map(line => { const p = record(line.position);
        return [String(line.seq), String(line.profile_code), String(line.finish), KG(p.agreed_kg), KG(p.consumed_kg), KG(p.available_kg), line.rate ? MONEY(line.rate) : "No rate in force",
          status === "active" ? <div key="a" className="flex flex-wrap gap-2">{inline({ action: "release.create", label: `Call off from line ${line.seq}`, fixed: { line_id: line.line_id } }, "Call off")}{inline({ action: "agreement.rate", label: `Rate revision for line ${line.seq}`, fixed: { line_id: line.line_id } }, "Rate")}
            {inline({ action: "agreement.amend", label: `Amend line ${line.seq}`, fixed: { line_id: line.line_id }, initial: { agreed_kg: String(p.agreed_kg ?? "") } }, "Amend")}</div> : ""]; })} /></Section>
      <Section title="Releases"><Table columns={["Release", "Line", "Quantity", "Site", "Delivery", "Status", "Rate snapshot", "Order", ""]} rows={releases.map(r => [String(r.release_number), `${r.line_seq} · ${r.profile_code}`, `${KG(r.quantity_kg)}${Number(r.returned_kg) > 0 ? ` (${KG(r.returned_kg)} returned)` : ""}`,
        String(r.site), readable(r.requested_date), String(r.status), r.rate_per_kg ? `${MONEY(r.rate_per_kg)} from ${readable(r.rate_effective_from)}` : "", readable(r.order_number),
        <div key="a" className="flex flex-wrap gap-2">{r.status === "scheduled" ? inline({ action: "release.firm", label: `Firm ${r.release_number}`, fixed: { id: r.id } }, "Firm") : null}
          {["scheduled", "firm"].includes(String(r.status)) ? inline({ action: "release.cancel", label: `Cancel or reduce ${r.release_number}`, fixed: { id: r.id } }, "Cancel") : null}
          {r.status === "firm" ? inline({ action: "release.fulfil", label: `Fulfil ${r.release_number}`, fixed: { id: r.id } }, "Fulfil") : null}
          {r.status === "fulfilled" ? inline({ action: "release.return", label: `Return against ${r.release_number}`, fixed: { id: r.id } }, "Return") : null}</div>])} /></Section></>;
  } else if (view === "tooling") {
    const status = String(d.agreement_status); const mine = d.created_by_id === context.userId; const p = record(d.position);
    if (status === "draft" && !mine) add({ action: "tooling.approve", label: "Approve this agreement", fixed: { id: row.id } });
    if (status === "active") { add({ action: "tooling.allocate", label: "Link a finance record", fixed: { id: row.id } }); add({ action: "tooling.dispute", label: d.disputed ? "Resolve the dispute" : "Open a dispute", fixed: { id: row.id, state: d.disputed ? "resolved" : "open" } }); }
    const masterMismatch = (d.die_master_ownership === "customer_owned") !== (d.owner_party === "customer");
    body = <><Section title="Agreement"><Facts entries={[["Agreement", `${d.agreement_number} v${d.version}`], ["Die", d.die_number], ["Customer", d.customer], ["Agreed owner", d.owner_party], ["Die master records", d.die_master_ownership], ["Die charge", MONEY(d.die_charge)],
      ["Customer contribution", MONEY(d.customer_contribution)], ["Waiver", MONEY(d.waiver_amount)], ["Recovery", d.recovery_basis === "per_kg" ? `${MONEY(d.recovery_rate_per_kg)} per kg up to ${MONEY(d.recovery_cap)}` : "None"], ["Tax and accounting reference", d.tax_reference], ["Terms", d.terms], ["Dispute", d.disputed ? d.dispute_note : "None open"]]} />
      <Notes items={masterMismatch ? ["The die master records a different ownership. Update it through the die workflow if ownership changed."] : []} />
      <Notes tone="slate" items={["Ownership is recorded as agreed, never inferred from who paid. Figures below come only from linked invoices, payments, credit notes and recoveries that still count."]} /></Section>
      <Section title="Commercial position"><Facts entries={[["Contribution after waiver", MONEY(p.contribution_due)], ["Charged", MONEY(p.charged)], ["Credited", MONEY(p.credited)], ["Received", MONEY(p.received)], ["Recovered through orders", MONEY(p.recovered)],
        ["Outstanding", MONEY(p.outstanding)], ["Not yet invoiced", MONEY(p.uninvoiced)], ["Recovery cap remaining", p.cap_remaining === null ? "No recovery" : MONEY(p.cap_remaining)], ["Linked records no longer counted", p.not_counted]]} />
        {p.over_recovered ? <Notes items={["More has been received or recovered than the contribution after the waiver."]} /> : null}</Section>
      <Section title="Linked finance records"><Table columns={["Kind", "Reference", "Amount", "Counted", "Linked", "Calculation", ""]} rows={list<Record<string, unknown>>(d.allocations).map(a => [String(a.kind).replaceAll("_", " "), readable(a.reference), MONEY(a.amount),
        a.reversed ? `Reversed${a.reverse_note ? `: ${a.reverse_note}` : ""}` : a.counted ? "Yes" : "No: source cancelled or reversed", readable(a.recorded_at),
        a.calc ? `${KG(record(a.calc).kg)} × ${MONEY(record(a.calc).rate)}` : "", !a.reversed && status === "active" ? inline({ action: "tooling.reverse", label: "Reverse a linked record", fixed: { id: row.id, allocation_id: a.id } }, "Reverse") : ""])} /></Section></>;
  } else if (view === "transfers") {
    const status = String(d.transfer_status); const lines = list<Record<string, unknown>>(d.lines);
    if (status === "requested") { add({ action: "transfer.issue", label: "Issue the transfer", fixed: { id: row.id } }); add({ action: "transfer.cancel", label: "Cancel", fixed: { id: row.id } }); }
    if (["in_transit", "partially_received"].includes(status)) add({ action: "transfer.receive", label: "Receive a bundle", fixed: { id: row.id } });
    if (status === "received") add({ action: "transfer.close", label: "Close the transfer", fixed: { id: row.id } });
    body = <><Section title="Transfer"><Facts entries={[["Destination", d.destination], ["Planned", d.planned_date], ["Requested by", d.requested_by], ["Issued by", d.issued_by], ["Issued", d.issued_at], ["Transport", d.transport_ref], ["Gate pass", d.gate_ref], ["Close note", d.close_note]]} />
      <Notes tone="slate" items={["Issued bundles are in transit: not free stock at the source or the destination until received. Receipt never clears a QC hold."]} /></Section>
      <Section title="Bundles"><Table columns={["Bundle", "Profile", "Pieces", "Weight", "From", "State", "Stock now", "QC", ""]} rows={lines.map(l => [String(l.bundle_label), String(l.profile_code), readable(l.pieces), KG(l.weight_kg), readable(l.source_location),
        `${String(l.state).replaceAll("_", " ")}${l.resolution_note ? ` · ${l.resolution_note}` : ""}`, `${readable(l.batch_status)} · ${readable(l.batch_location)}`, readable(l.qc_status),
        l.state === "in_transit" ? <div key="a" className="flex flex-wrap gap-2">{inline({ action: "transfer.receive", label: `Receive ${l.bundle_label}`, fixed: { id: row.id, bundle_label: l.bundle_label } }, "Receive")}
          {inline({ action: "transfer.dispose", label: `Disposition of ${l.bundle_label}`, fixed: { line_id: l.id } }, "Damaged, returned or lost")}</div> : ""])} /></Section></>;
  } else if (view === "treatment") {
    if (d.kind === "recipe") {
      const status = String(d.recipe_status); const mine = d.created_by_id === context.userId;
      if (status === "draft" && !mine) add({ action: "recipe.approve", label: "Approve this revision", fixed: { id: row.id } });
      if (status === "approved") add({ action: "treat.create", label: "Load a batch", fixed: { recipe_id: row.id } });
      body = <Section title="Recipe revision"><Facts entries={[["Recipe", `${d.recipe_code} rev ${d.revision}`], ["Name", d.name], ["Process", d.process], ["Compatible alloys", list<string>(d.alloys).join(", ")], ["Target temper", d.target_temper],
        ["Temperature", `${readable(d.temp_min_c)} to ${readable(d.temp_max_c)} °C`], ["Cycle", `${d.soak_min_minutes} to ${d.soak_max_minutes} minutes`], ["Readings required", d.min_readings], ["Defined by", d.created_by], ["Approved by", d.approved_by]]} />
        <Notes tone="slate" items={["Recipe values are targets set by the technical owner. They never become recorded readings."]} /></Section>;
    } else {
      const status = String(d.batch_status); const ax = record(d.assessment); const inputs = list<Record<string, unknown>>(d.inputs);
      if (status === "loaded") add({ action: "treat.start", label: "Start the cycle", fixed: { id: row.id } });
      if (status === "running") { add({ action: "treat.observe", label: "Record a reading", fixed: { id: row.id } }); add({ action: "treat.end", label: "End the cycle", fixed: { id: row.id } }); }
      if (["ended", "interrupted"].includes(status)) add({ action: "treat.review", label: "Review the batch", fixed: { id: row.id }, fixedRows: true,
        initial: { outcomes: JSON.stringify(inputs.map(input => ({ input_id: input.id, label: `${input.job_number} · ${KG(input.quantity_kg)}`, accepted_kg: "", rejected_kg: "", retreat_kg: "" }))) } });
      body = <><Section title="Batch"><Facts entries={[["Recipe", `${d.recipe_code} rev ${d.revision} (${readable(d.recipe_status)})`], ["Oven", d.machine], ["Loading", d.load_note], ["Loaded by", d.loaded_by], ["Started", d.started_at], ["Ended", d.ended_at],
        ["Cycle length", ax.soak_minutes == null ? "Not ended" : `${readable(ax.soak_minutes)} min (recipe ${d.soak_min_minutes} to ${d.soak_max_minutes})`], ["Readings", `${ax.readings} of ${ax.required_readings} required`], ["Range read", ax.min_c == null ? "No reading" : `${readable(ax.min_c)} to ${readable(ax.max_c)} °C`],
        ["Retreatment of", d.retreatment_of]]} />
        <Notes items={list<string>(ax.deviations)} />
        <Notes tone="slate" items={["A completed timer is not proof of conformance. Review decides acceptance; mechanical or hardness tests still follow the quality plan."]} /></Section>
        <Section title="Inputs and where they came from"><Table columns={["Job", "Order", "Profile", "Alloy", "Loaded", "Accepted", "Rejected", "Retreatment"]} rows={inputs.map(input => [String(input.job_number), String(input.order_number), String(input.profile_code), `${readable(input.alloy)} ${readable(input.temper)}`,
          KG(input.quantity_kg), input.accepted_kg == null ? "" : KG(input.accepted_kg), input.rejected_kg == null ? "" : KG(input.rejected_kg), input.retreat_kg == null ? "" : KG(input.retreat_kg)])} /></Section>
        <Section title="Readings as taken"><Table columns={["Time", "Temperature", "Instrument", "In range", "Note"]} rows={list<Record<string, unknown>>(d.observations).map(o => [readable(o.observed_at), `${readable(o.temperature_c)} °C`, String(o.instrument_ref), o.in_range ? "Yes" : "No", readable(o.note)])} /></Section>
        {d.review ? <Section title="Review"><Facts entries={[["Deviation accepted", record(d.review).accept_deviation], ["Reason", record(d.review).note], ["Reviewed", d.reviewed_at]]} /></Section> : null}</>;
    }
  } else if (view === "tolling") {
    if (d.kind === "agreement") {
      const status = String(d.agreement_status); const mine = d.created_by_id === context.userId;
      if (status === "draft" && !mine) add({ action: "toll.approve", label: "Approve this agreement", fixed: { id: row.id } });
      body = <Section title="Job-work agreement"><Facts entries={[["Customer", d.customer], ["Revision", d.revision], ["Material", d.material_spec], ["Alloy", d.alloy], ["Mixing with company metal", d.permitted_mixing ? "Authorised" : "Not authorised"],
        ["Loss allowance", d.allowed_loss_percent === null ? "None agreed" : `${readable(d.allowed_loss_percent)}%`], ["Conversion", `${MONEY(d.conversion_rate_per_kg)} per kg of ${readable(d.billing_basis)}`], ["Defined by", d.created_by], ["Approved", d.approved_at]]} />
        <Notes tone="slate" items={["Agreement interpretation, tax and accounting treatment need authorised review. Loss percentages are never assumed."]} />
        <Link href={`/tasks/specialist/tolling/${d.customer_id}`} className="inline-flex min-h-11 items-center text-sm font-bold underline">Open the customer metal account</Link></Section>;
    } else {
      const p = record(d.position); const totals = record(d.totals); const receipts = list<Record<string, unknown>>(p.receipts); const jobs = list<Record<string, unknown>>(p.jobs); const statements = list<Record<string, unknown>>(d.statements);
      add({ action: "toll.receive", label: "Receive metal", fixed: { customer_id: row.id } }); add({ action: "toll.move", label: "Record a movement", fixed: { customer_id: row.id } }); add({ action: "toll.statement", label: "Prepare a statement", fixed: { customer_id: row.id } });
      add({ action: "toll.define", label: "Define or revise the agreement", fixed: { customer_id: row.id } });
      body = <><Section title="Account"><Facts entries={[["Received and accepted", KG(totals.received_accepted_kg)], ["Awaiting inspection", KG(totals.received_pending_kg)], ["Rejected", KG(totals.received_rejected_kg)], ["Usable now", KG(totals.usable_kg)],
        ["Issued to jobs", KG(totals.issued_kg)], ["Good output", KG(totals.output_kg)], ["Process scrap", KG(totals.scrap_kg)], ["Explained loss", KG(totals.explained_loss_kg)], ["In process", KG(totals.in_process_kg)], ["Unexplained (completed jobs)", KG(totals.unexplained_kg)],
        ["Metal returned", KG(totals.returned_metal_kg)], ["Scrap returned", KG(totals.returned_scrap_kg)], ["Scrap held", KG(totals.scrap_on_hand_kg)]]} />
        <Notes tone="slate" items={["Customer-owned metal is its own account and is never company billet stock. It is used only for this customer's jobs; differences stay open until settled."]} /></Section>
        <Section title="Receipts"><Table columns={["Receipt", "Challan", "Heat", "Received", "Quality", "Issued", "Returned", "Usable", ""]} rows={receipts.map(r => [String(r.receipt_number), String(r.challan_ref), readable(r.heat_ref), KG(r.received_kg), String(r.quality_status), KG(r.issued_kg), KG(r.returned_kg), KG(r.usable_kg),
          r.quality_status === "pending" ? inline({ action: "toll.inspect", label: `Inspect ${r.receipt_number}`, fixed: { receipt_id: r.receipt_id } }, "Inspect") : ""])} /></Section>
        <Section title="Jobs using this metal"><Table columns={["Job", "Order", "Status", "Issued", "Output", "Scrap", "Explained loss", "Allowance", "In process", "Unexplained"]} rows={jobs.map(j => [String(j.job_number), String(j.order_number), String(j.job_status), KG(j.issued_kg), KG(j.output_kg), KG(j.scrap_kg),
          KG(j.explained_loss_kg), j.allowed_loss_kg == null ? "None agreed" : KG(j.allowed_loss_kg), KG(j.in_process_kg), KG(j.unexplained_kg)])} /></Section>
        <Section title="Recent movements"><Table columns={["When", "Movement", "Quantity", "Receipt", "Job", "Status", ""]} rows={list<Record<string, unknown>>(d.movements).map(m => [readable(m.recorded_at), String(m.kind).replaceAll("_", " "), KG(m.quantity_kg), readable(m.receipt_number), readable(m.job_number),
          m.status === "reversed" ? `Reversed${m.reverse_note ? `: ${m.reverse_note}` : ""}` : "Counted", m.status === "active" ? inline({ action: "toll.reverse", label: "Reverse a movement", fixed: { movement_id: m.id } }, "Reverse") : ""])} /></Section>
        <Section title="Statements"><Table columns={["Statement", "As of", "Status", "Charge basis", "Conversion charge draft", "Unexplained", ""]} rows={statements.map(s => { const m = record(s.model);
          return [String(s.statement_number), readable(s.as_of), String(s.status), `${KG(m.charge_basis_kg)} of ${readable(m.charge_basis)}`, MONEY(m.conversion_charge_draft), KG(record(m.totals).unexplained_kg),
            ["draft", "disputed"].includes(String(s.status)) ? inline({ action: "toll.settle", label: `Settle ${s.statement_number}`, fixed: { statement_id: s.id } }, "Settle") : ""]; })} />
          <p className="text-xs text-slate-600">A statement and its conversion charge are drafts for review with the customer. No invoice is created here.</p></Section></>;
    }
  } else {
    const status = String(d.session_status); const readings = list<Record<string, unknown>>(d.readings); const expected = record(d.expected); const pairing = record(d.pairing);
    const gross = readings.filter(r => r.kind === "gross" && r.stable); const tare = readings.filter(r => r.kind === "tare" && r.stable);
    if (status === "open") add({ action: "weigh.read", label: "Record a reading", fixed: { id: row.id }, initial: { vehicle_registration_read: String(d.vehicle_registration ?? "") } });
    if (status === "paired") add({ action: "weigh.finalize", label: "Finalise", fixed: { id: row.id } });
    if (["open", "paired", "finalized"].includes(status)) add({ action: "weigh.supersede", label: "Supersede for correction", fixed: { id: row.id } });
    if (["open", "paired"].includes(status)) add({ action: "weigh.cancel", label: "Cancel", fixed: { id: row.id } });
    body = <><Section title="Session"><Facts entries={[["Vehicle", d.vehicle_registration], ["Movement", d.movement_kind === "dispatch" ? `Dispatch ${readable(d.dispatch_number)}` : `Purchase receipt ${readable(d.receipt_reference)}`], ["Weighbridge", d.instrument_ref],
      ["Calibration valid until", `${readable(d.calibration_valid_until)}${d.calibration_valid ? "" : " (expired)"}`], ["Accepted difference", KG(d.tolerance_kg)], ["Net", KG(d.net_kg)], ["Expected", d.expected_kg == null ? "Nothing to compare" : KG(d.expected_kg)],
      ["Difference", d.difference_kg == null ? "Not available" : KG(d.difference_kg)], ["Difference accepted", d.accepted_difference], ["Supersedes", d.supersedes], ["Superseded by", d.superseded_by], ["Note", d.closed_note]]} />
      <Notes items={[...(d.calibration_valid ? [] : ["The calibration evidence has expired. This session cannot be finalised."]), ...(pairing.reversed_order ? ["The readings were taken in the reverse of the usual order."] : [])]} />
      <Notes tone="slate" items={["Readings are kept as recorded. Finalising never overwrites measured bundle or receipt weights."]} /></Section>
      <Section title="What the net weight is compared with"><Facts entries={[["Basis", expected.basis], ["Bundles", expected.bundles], ["Expected", KG(expected.expected_kg)], ["Metal by bundle records", KG(expected.metal_kg)], ["Packaging by bundle records", KG(expected.packaging_kg)],
        ["Lines in other units (not compared)", expected.other_unit_lines]]} /></Section>
      <Section title="Readings"><Table columns={["Reading", "Weight", "Taken", "Source", "Packet", "Slip", "Stable", "Paired"]} rows={readings.map(r => [String(r.kind), `${readable(r.weight_value)} ${r.unit}${r.unit === "t" ? ` (${KG(r.weight_kg)})` : ""}`, readable(r.read_at), String(r.source), readable(r.provider_ref), readable(r.slip_ref), r.stable ? "Yes" : "No", r.paired ? "Yes" : ""])} />
        {status === "open" && gross.length && tare.length && canUseSpecialistAction(context.role, "weigh.pair") ? <div className="flex flex-wrap gap-2">{gross.flatMap(g => tare.map(t => <Button key={`${g.id}:${t.id}`} type="button" variant="secondary"
          onClick={() => setOpen({ action: "weigh.pair", label: `Pair gross ${KG(g.weight_kg)} with tare ${KG(t.weight_kg)}`, fixed: { id: row.id, gross_reading_id: g.id, tare_reading_id: t.id } })}>Pair {KG(g.weight_kg)} / {KG(t.weight_kg)}</Button>))}</div> : null}</Section></>;
  }

  return <div className="space-y-4">
    <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-2"><h2 className="break-words text-lg font-bold">{row.label}</h2><Badge value={row.status} /></div>
      <p className="text-sm font-semibold text-slate-700">{specialistStatusLabel(row.status, view)}</p><p className="break-words text-sm text-slate-600">{row.summary}</p>
      {row.source_href ? <Link href={row.source_href} className="inline-flex min-h-11 items-center text-sm font-bold underline">Open the source record</Link> : null}</section>
    {commands.length || open ? <section aria-label="Available actions" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"><h2 className="font-bold">Actions</h2>
      <div className="flex flex-wrap gap-2">{commands.map(command => <Button key={`${command.action}:${JSON.stringify(command.fixed ?? {})}`} type="button" variant={open?.action === command.action && open.label === command.label ? "primary" : "secondary"} onClick={() => setOpen(command)}>{command.label}</Button>)}</div>
      {open ? <div className="rounded-xl border border-slate-200 p-3"><SpecialistMutationForm key={`${open.action}:${JSON.stringify(open.fixed ?? {})}`} action={open.action} role={context.role} fixed={open.fixed} initial={open.initial} fixedRows={open.fixedRows} title={open.label || SPECIALIST_ACTION_FORMS[open.action].title} /></div> : null}</section> : null}
    {body}
    <p className="text-xs text-slate-500">Current authorized read as of {new Date(detail.as_of).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST. Figures are advisory; source workflows keep their own controls.</p>
  </div>;
}
