"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CommercialMutationForm, COMMERCIAL_ACTION_FORMS } from "./mutation-form";
import { canUseCommercialAction, commercialStatusLabel, transferCsv, type CommercialAction, type CommercialDetail, type CommercialView } from "@/lib/workflow/commercial";
import type { SessionContext } from "@/types/app";
import { formatDate } from "@/lib/utils/format";

const MONEY = (value: unknown) => (value === null || value === undefined || value === "" ? "Not recorded" : `INR ${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
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

type Command = { action: CommercialAction; label: string; fixed?: Record<string, unknown>; initial?: Record<string, string> };

export function CommercialRecord({ view, detail, context }: { view: CommercialView; detail: CommercialDetail; context: SessionContext }) {
  const row = detail.row; const d = row.details;
  const [open, setOpen] = useState<Command | null>(null);
  const commands: Command[] = [];
  const add = (command: Command) => { if (canUseCommercialAction(context.role, command.action)) commands.push(command); };
  let body: ReactNode = null;

  if (view === "pricing") {
    if (d.kind === "rule") {
      const mine = d.created_by_id === context.userId;
      if (d.rule_status === "draft" && !mine) add({ action: "pricing.approve", label: "Approve this rule", fixed: { id: row.id } });
      if (d.rule_status !== "retired") add({ action: "pricing.retire", label: "Retire this rule", fixed: { id: row.id } });
      body = <><Section title="Rule"><Facts entries={[["Code and version", `${d.code} v${d.version}`], ["Charge", `${readable(d.charge_type)} per ${d.unit_basis}`], ["Customer", d.customer ?? "All customers"], ["Finish", d.finishing_type ?? "Any finish"],
        ["Processing code", d.processing_code], ["Amount", d.amount === null ? null : MONEY(d.amount)], ["Precedence", d.precedence], ["Effective from", d.effective_from], ["Effective until", d.effective_to ?? "No end date"], ["Defined by", d.created_by], ["Approved by", d.approved_by]]} />
        {d.rule_status === "draft" && mine ? <Notes tone="slate" items={["A second person approves this rule. The person who defined it cannot."]} /> : null}</Section>
        {list(d.brackets).length ? <Section title="Quantity brackets"><p className="text-xs text-slate-600">A bracket starts at its start and ends before its end. The whole quantity is priced at the bracket it reaches.</p>
          <Table columns={["Start", "End", `Rate per ${d.unit_basis}`]} rows={list<Record<string, unknown>>(d.brackets).map(b => [readable(b.from_qty), b.to_qty === null ? "No upper end" : readable(b.to_qty), MONEY(b.rate)])} /></Section> : null}</>;
    } else {
      if (d.calc_status === "recorded") add({ action: "pricing.void", label: "Void this price", fixed: { id: row.id } });
      const s = record(d.snapshot); const bracket = record(s.bracket); const minimum = record(s.minimum);
      body = <><Section title="Recorded price"><Facts entries={[["Customer", d.customer], ["Quantity", `${readable(d.quantity)} ${d.unit_basis}`], ["Finish", d.finishing_type], ["Priced on", d.calc_date], ["Quotation", d.quote_number ?? "Not attached"],
        ["Rule total", MONEY(d.rule_total)], ["Recorded total", MONEY(d.final_total)], ["Override rate", d.override_rate === null ? "None" : MONEY(d.override_rate)], ["Override reason", d.override_reason]]} /></Section>
        <Section title="How it was calculated"><Table columns={["Step", "Rule", "Amount"]} rows={[
          ["Volume rate", `${bracket.code} v${bracket.version}: ${readable(bracket.from_qty)} to ${bracket.to_qty === null ? "no upper end" : readable(bracket.to_qty)} at ${MONEY(bracket.rate)}`, MONEY(s.base_amount)],
          ...list<Record<string, unknown>>(s.processing).map(p => ["Processing", `${p.processing_code} v${p.version}: ${MONEY(p.rate)} per unit`, MONEY(p.amount)]),
          ["Subtotal", "", MONEY(s.subtotal)], ["Minimum charge", minimum.code ? `${minimum.code} v${minimum.version}: ${MONEY(minimum.amount)}${minimum.applied ? " (applied)" : " (not reached)"}` : "No minimum rule", minimum.applied ? MONEY(s.minimum_uplift) : "None"],
          ["Total before GST", "", MONEY(d.final_total)]]} /><p className="text-xs text-slate-600">Prices exclude GST. The rule versions above are kept even if the rules change later.</p></Section></>;
    }
  } else if (view === "claims") {
    const status = String(d.raw_status); const open_ = ["submitted", "disputed", "agreed", "partially_recovered"].includes(status);
    if (open_) add({ action: "claim.respond", label: "Record the supplier response", fixed: { id: row.id } });
    if (["agreed", "partially_recovered"].includes(status)) add({ action: "claim.link", label: "Link a recovery", fixed: { id: row.id } });
    if (open_) add({ action: "claim.close", label: "Close the claim", fixed: { id: row.id } });
    const pool = record(d.pool);
    body = <><Section title="Claim"><Facts entries={[["Supplier", d.vendor], ["Purchase order", `${d.po_number} line ${d.line}`], ["Item", d.description], ["Claim", d.claim_type], ["Claimed", `${readable(d.claimed_quantity)} ${d.unit} / ${MONEY(d.claimed_amount)}`], ["Remedy requested", d.requested_remedy],
      ["Agreed", d.agreed_quantity === null ? "Not yet agreed" : `${readable(d.agreed_quantity)} ${d.unit} / ${MONEY(d.agreed_amount)}`], ["Recovered", `${readable(d.recovered_quantity)} ${d.unit} / ${MONEY(d.recovered_amount)}`],
      ["Supplier response due", d.response_due], ["Last response", d.last_response_at], ["Follow-up owner", d.follow_up_owner], ["Closed", d.closed_at], ["Unresolved at close", d.unresolved_quantity === null ? null : `${readable(d.unresolved_quantity)} ${d.unit} / ${MONEY(d.unresolved_amount)}`], ["Close note", d.close_note]]} />
      <Notes tone="slate" items={["An agreed claim is not a recovery. It closes only when the agreed quantity and amount are linked to real receipts or posted credits."]} />
      {d.response_overdue ? <Notes items={["The supplier response date has passed."]} /> : null}</Section>
      {pool.unit ? <Section title="Quantity open to claim on this line"><Facts entries={[["Ordered", pool.ordered], ["Received", pool.received], ["Rejected at receipt", pool.rejected], ["Held at receipt", pool.held], ["Open to claim now", pool.available]]} /></Section> : null}
      <Section title="Linked recoveries"><Table columns={["Kind", "Quantity", "Amount", "Linked", "Status", ""]} rows={list<Record<string, unknown>>(d.recoveries).map(r => [String(r.kind), readable(r.quantity), MONEY(r.amount), readable(r.recorded_at), r.reversed ? `Reversed${r.reverse_note ? `: ${r.reverse_note}` : ""}` : "Counted",
        !r.reversed && ["agreed", "partially_recovered"].includes(status) && canUseCommercialAction(context.role, "claim.unlink") ? <Button type="button" variant="secondary" onClick={() => setOpen({ action: "claim.unlink", label: "Reverse a linked recovery", fixed: { id: row.id, recovery_id: r.id } })}>Reverse</Button> : ""])} /></Section></>;
  } else if (view === "profitability") {
    add({ action: "profit.snapshot", label: "Record a snapshot", fixed: { order_id: row.id } });
    const m = record(d.model); const est = record(m.estimate); const costs = list<Record<string, unknown>>(m.recorded_costs);
    body = <><Section title="Status"><Facts entries={[["Order", m.order_number], ["Status", m.status === "finalized" ? "Finalised" : "Provisional"], ["Adjusted after final", m.adjusted_after_final], ["Latest snapshot", record(m.latest_snapshot).recorded_at]]} />
      <Notes items={list<string>(m.missing)} /></Section>
      <Section title="Estimate and what is recorded"><Table columns={["Item", "Estimated (accepted quotation)", "Recorded"]} rows={[
        ["Revenue before GST", MONEY(m.estimated_revenue), m.net_revenue === null ? "Not recorded" : `${MONEY(m.net_revenue)} net of ${MONEY(m.credited)} credit notes`],
        ["Material cost", MONEY(est.material), "Not derived from stock here"], ["Conversion cost", MONEY(est.conversion), "Not derived from machine hours here"], ["Finishing cost", MONEY(est.finishing), "See linked expenses"], ["Die amortisation", MONEY(est.die), "Not recorded"],
        ["Packing", MONEY(est.packing), "See linked expenses"], ["Transport", MONEY(est.transport), "See linked expenses"], ["Other charges", MONEY(est.other), "See linked expenses"],
        ["Total cost", MONEY(m.estimated_cost), m.recorded_cost_total === null ? "Not recorded" : `${MONEY(m.recorded_cost_total)} from ${m.recorded_cost_lines} linked expense line(s)`],
        ["Margin", MONEY(m.estimated_margin), m.recorded_margin === null ? "Not available" : MONEY(m.recorded_margin)]]} />
        <p className="text-xs text-slate-600">Recorded cost counts only expenses linked to this order, its jobs, finishing jobs or dispatches. A blank is missing information, not zero.</p></Section>
      <Section title="Linked expenses by category"><Table columns={["Category", "Lines", "Amount"]} rows={costs.map(c => [String(c.category).replaceAll("_", " "), readable(c.lines), MONEY(c.amount)])} /></Section>
      <Section title="Quantities"><Facts entries={[["Estimated weight (kg)", m.estimated_kg], ["Billet issued (kg)", m.billet_kg_issued], ["Produced (kg)", m.produced_kg], ["Scrap recorded (kg)", m.scrap_kg], ["Dispatched (kg)", m.dispatched_kg]]} /></Section></>;
  } else if (view === "reliability") {
    add({ action: "commitment.set", label: "Record a promised date" });
    const m = record(d.metrics); const fin = record(m.finishing); const claims = record(m.claims);
    body = <><Section title="Purchasing evidence"><Facts entries={[["Purchase orders", m.purchase_orders], ["With a recorded promise", m.with_commitment], ["Received on or before the original promise", m.on_time], ["Received late", m.late], ["Past the promise with nothing received", m.open_past_date],
      ["Open claims", claims.open], ["Closed claims", claims.closed], ["Sample", m.sample_ok ? "Enough orders to read" : "Small sample: not a ranking"]]} />
      <Table columns={["Unit", "Ordered", "Received", "Accepted", "Rejected", "Held"]} rows={list<Record<string, unknown>>(m.units).map(u => [String(u.unit), readable(u.ordered), readable(u.received), readable(u.accepted), readable(u.rejected), readable(u.held)])} />
      <p className="text-xs text-slate-600">Units are never added together. Lateness is measured against the original promise, even after a revision.</p></Section>
      {Number(fin.jobs) > 0 ? <Section title="Finishing vendor evidence"><Facts entries={[["Finishing jobs", fin.jobs], ["With sent and received dates", fin.measured], ["Average turnaround (days)", fin.avg_turnaround_days], ["Input (kg)", fin.input_kg], ["Rejected (kg)", fin.rejected_kg],
        ["Sample", m.finishing_sample_ok ? "Enough jobs to read" : "Small sample: not a ranking"]]} /></Section> : null}
      <Section title="Recent purchase orders"><Table columns={["Order", "Ordered", "Original promise", "Current promise", "Revisions", "First receipt", "Result"]} rows={list<Record<string, unknown>>(d.orders).map(o => [String(o.po_number), readable(o.order_date), readable(o.original_date), readable(o.current_date), readable(o.revisions ?? 0), readable(o.first_receipt), String(o.result)])} /></Section></>;
  } else if (view === "outcomes") {
    const cls = String(d.class);
    if (["needs_reason", "open"].includes(cls)) add({ action: "outcome.record", label: "Record the outcome", fixed: { quote_id: row.id } });
    if (["lost", "withdrawn", "no_decision"].includes(cls)) add({ action: "outcome.reopen", label: "Reopen the quotation", fixed: { quote_id: row.id } });
    const share = record(d.share);
    body = <Section title="Quotation"><Facts entries={[["Quotation", d.quote_number], ["Customer", d.customer], ["Quotation status", d.quote_status], ["Revision", d.quote_revision], ["Quoted on", d.quote_date], ["Valid until", d.valid_until], ["Value before GST", MONEY(d.value)],
      ["Orders linked", share.orders], ["Ordered (kg)", share.ordered_kg], ["Quoted (kg)", share.quoted_kg], ["Outcome", d.outcome ?? "None recorded"], ["Reason", d.reason_code], ["Where the reason came from", d.evidence], ["Product family", d.product_family], ["Recorded", d.recorded_at]]} />
      {d.evidence === "sales_observed" ? <Notes tone="slate" items={["This reason is a sales observation, not a customer-confirmed cause."]} /> : null}</Section>;
  } else if (view === "cohorts") {
    body = <><Section title={`Quotations issued in ${d.month}`}><Table columns={["Result", "Quotations"]} rows={[["Won (orders cover the quotation)", readable(d.won)], ["Partly won", readable(d.partially_won)], ["Lost", readable(d.lost)], ["Withdrawn", readable(d.withdrawn)], ["No decision", readable(d.no_decision)],
      ["Awaiting a reason", readable(d.needs_reason)], ["Still open", readable(d.open)], ["All issued quotations", readable(d.quotations)]]} />
      <p className="text-sm">{readable(d.decided)} of {readable(d.quotations)} issued quotations have an outcome. Quotation value {MONEY(d.value)}; won or partly won {MONEY(d.won_value)}.</p>
      <p className="text-xs text-slate-600">Each quotation counts once however many times it was revised. A win comes from linked orders, never from a sales entry.</p></Section>
      <Section title="Reasons given"><Table columns={["Reason", "Quotations"]} rows={Object.entries(record(d.reasons)).map(([reason, count]) => [reason.replaceAll("_", " "), readable(count)])} />
        <Table columns={["Where the reason came from", "Quotations"]} rows={Object.entries(record(d.evidence)).map(([kind, count]) => [kind.replaceAll("_", " "), readable(count)])} /></Section></>;
  } else if (view === "remnants") {
    const lot = String(d.lot_status); const open_ = ["available", "held"].includes(lot);
    if (open_) { add({ action: "remnant.review", label: "Review the lot", fixed: { id: row.id } }); add({ action: "remnant.reserve", label: "Reserve pieces", fixed: { id: row.id } }); add({ action: "remnant.correct", label: "Correct the measurement", fixed: { id: row.id }, initial: { length_mm: String(d.length_mm), pieces: String(d.pieces) } }); add({ action: "remnant.scrap", label: "Scrap the lot", fixed: { id: row.id } }); }
    add({ action: "remnant.record", label: "Record another remnant" });
    body = <><Section title="Lot"><Facts entries={[["Profile", `${d.profile_code} · ${d.profile_name}`], ["Alloy and temper", `${d.alloy ?? "not set"} ${d.temper ?? ""}`], ["Finish", d.finish], ["Measured length (mm)", d.length_mm], ["Pieces now", d.pieces], ["Pieces first recorded", d.original_pieces],
      ["Reserved", d.reserved_pieces], ["Free", d.free_pieces], ["Total weight (kg)", d.total_weight_kg], ["Origin", d.origin_type], ["Location", d.location], ["Condition", d.condition], ["Ownership", d.ownership], ["Age (days)", d.age_days]]} />
      <Notes tone="slate" items={["This is a register entry. It does not post to the profile stock ledger; reconcile it with the physical rack."]} /></Section>
      <Section title="Requirements this lot can cover"><p className="text-xs text-slate-600">Same profile, alloy, temper and finish, and the cut fits inside the measured length. Kilograms alone are never enough.</p>
        <Table columns={["Order", "Customer", "Cut (mm)", "Pieces open", "Waste per piece (mm)", "Due", ""]} rows={list<Record<string, unknown>>(d.matches).map(m => [String(m.order_number), String(m.customer ?? ""), readable(m.cut_length_mm), readable(m.pieces_open), readable(m.waste_mm_per_piece), readable(m.due),
          canUseCommercialAction(context.role, "remnant.reserve") ? <Button type="button" variant="secondary" onClick={() => setOpen({ action: "remnant.reserve", label: "Reserve pieces", fixed: { id: row.id, order_item_id: m.order_item_id } })}>Reserve</Button> : ""])} /></Section>
      <Section title="Reservations"><Table columns={["Order", "Pieces", "Cut (mm)", "Waste (mm)", "Status", ""]} rows={list<Record<string, unknown>>(d.allocations).map(a => [String(a.order_number), readable(a.pieces), readable(a.cut_length_mm), readable(a.waste_mm_per_piece), String(a.status),
        a.status === "reserved" && canUseCommercialAction(context.role, "remnant.consume") ? <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" onClick={() => setOpen({ action: "remnant.consume", label: "Record as cut and used", fixed: { id: a.id } })}>Used</Button>
          <Button type="button" variant="secondary" onClick={() => setOpen({ action: "remnant.release", label: "Release the reservation", fixed: { id: a.id } })}>Release</Button></div> : ""])} /></Section></>;
  } else if (view === "transfers") {
    if (d.kind === "mapping") {
      if (d.mapping_status === "draft" && d.created_by_id !== context.userId) add({ action: "mapping.approve", label: "Approve this mapping", fixed: { id: row.id } });
      if (d.mapping_status !== "retired") add({ action: "mapping.retire", label: "Retire this mapping", fixed: { id: row.id } });
      if (d.mapping_status === "approved") add({ action: "transfer.prepare", label: "Prepare a batch" });
      body = <Section title="Mapping"><Facts entries={[["Version", d.version], ["Sales ledger", d.sales_ledger], ["Tax ledger", d.tax_ledger], ["Party identified by", d.party_key], ["Defined by", d.created_by], ["Approved", d.approved_at], ["Invoices waiting for export", d.eligible_invoices]]} />
        <Notes tone="slate" items={["Only the field mapping is versioned here. No connection to an accounting package is assumed; the file is imported by a person."]} /></Section>;
    } else {
      const items = list<Record<string, unknown>>(d.items); const batch = String(d.batch_status);
      if (batch === "prepared") { add({ action: "transfer.export", label: "Record as exported", fixed: { id: row.id } }); add({ action: "transfer.cancel", label: "Cancel the batch", fixed: { id: row.id } }); }
      const download = () => {
        const csv = transferCsv(items.map(item => ({ external_ref: String(item.external_ref), invoice_number: String(item.invoice_number), invoice_date: String(item.invoice_date), party: String(item.party), amount: Number(item.amount), tax_amount: Number(item.tax_amount) })),
          { sales_ledger: String(d.sales_ledger), tax_ledger: String(d.tax_ledger) });
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        const link = document.createElement("a"); link.href = url; link.download = `${d.batch_number}.csv`; link.click(); URL.revokeObjectURL(url);
      };
      body = <><Section title="Batch"><Facts entries={[["Batch", d.batch_number], ["Mapping version", d.mapping_version], ["Invoices", d.item_count], ["Total", MONEY(d.total_amount)], ["Prepared", d.prepared_at], ["Exported", d.exported_at], ["Accepted", d.accepted], ["Rejected", d.rejected], ["Awaiting a result", d.pending], ["Checksum", d.checksum]]} />
        {["prepared", "exported"].includes(batch) ? <Button type="button" variant="secondary" onClick={download}>Download the file for the accounting package</Button> : null}
        <Notes tone="slate" items={["Downloading or exporting writes nothing into the accounting package. An invoice counts as transferred only when the package's result is recorded."]} /></Section>
        <Section title="Invoices in this batch"><Table columns={["External reference", "Invoice", "Taxable", "Tax", "State", "Package reference", ""]} rows={items.map(item => [String(item.external_ref), String(item.invoice_number), MONEY(item.amount), MONEY(item.tax_amount),
          `${item.state}${item.changed_since ? " · invoice changed since export" : ""}${item.reason ? ` · ${item.reason}` : ""}`, readable(item.external_reference),
          item.state === "pending" && batch === "exported" && canUseCommercialAction(context.role, "transfer.result") ? <Button type="button" variant="secondary" onClick={() => setOpen({ action: "transfer.result", label: "Record the accounting package result", fixed: { id: item.id } })}>Record result</Button> : ""])} /></Section></>;
    }
  } else if (view === "runs") {
    const g = record(d.group); const status = String(d.run_status);
    if (status === "suggested" && !d.blocked) add({ action: "run.save", label: "Save this proposal", fixed: { group_key: d.group_key } });
    if (status === "proposed") { add({ action: "run.accept", label: "Accept the proposal", fixed: { id: row.id } }); add({ action: "run.dismiss", label: "Dismiss the proposal", fixed: { id: row.id } }); }
    if (status === "stale") add({ action: "run.dismiss", label: "Dismiss the proposal", fixed: { id: row.id } });
    body = <><Section title="Proposed run"><Facts entries={[["Die", g.die_number], ["Profile", g.profile_code], ["Jobs", g.member_count], ["Orders", g.orders], ["Total (kg)", g.total_kg], ["Changeovers saved", g.changeovers_saved], ["Earliest due", g.earliest_due], ["Finish", g.finish], ["Drawing revision", g.drawing_revision],
      ["Other jobs on this die not merged", g.not_merged], ["Decision", d.decision_note]]} />
      <Notes items={[...(d.blocked ? ["The die cannot run: it is blocked or out on a gate pass."] : []), ...(status === "stale" ? ["The jobs changed since this was proposed. Dismiss it and review the new proposal."] : [])]} />
      <Notes tone="slate" items={["Advisory only. Setup time, run time and yield are not estimated, and nothing is scheduled by saving or accepting."]} /></Section>
      <Section title="Jobs and what each order contributes"><Table columns={["Job", "Order", "Customer", "Quantity (kg)", "Due", "Planned"]} rows={list<Record<string, unknown>>(g.members).map(m => [String(m.job_number), String(m.order_number), String(m.customer ?? ""), readable(m.kg), readable(m.due), readable(m.planned_date)])} /></Section></>;
  } else {
    const status = String(d.scenario_status); const mine = d.created_by_id === context.userId;
    if (status === "draft") add({ action: "scenario.share", label: "Share for review", fixed: { id: row.id } });
    if (["draft", "shared"].includes(status)) add({ action: "scenario.discard", label: "Discard", fixed: { id: row.id } });
    if (status === "shared" && !mine) add({ action: "scenario.accept", label: "Accept this scenario", fixed: { id: row.id } });
    const s = record(d.summary);
    body = <><Section title="Hypothetical scenario"><Notes items={["Everything below is hypothetical. It never changes a job, date, assignment or customer promise."]} />
      <Facts entries={[["Name", d.name], ["Horizon", `${d.horizon_days} days from ${readable(d.horizon_start)}`], ["Status", status], ["Created by", d.created_by], ["Jobs finishing later", s.jobs_delayed], ["Newly late", s.newly_late], ["Newly unscheduled in the horizon", s.newly_unscheduled],
        ["Jobs not simulated", s.not_simulated], ["Unscheduled kg (current plan)", s.unscheduled_kg_baseline], ["Unscheduled kg (scenario)", s.unscheduled_kg_scenario], ["Decision note", d.decision_note]]} />
      {d.stale ? <Notes items={["Jobs, capacity or maintenance changed since the snapshot. It cannot be accepted; create a new scenario from current data."]} /> : null}</Section>
      <Section title="Changes tested"><ol className="space-y-1 text-sm">{list<Record<string, unknown>>(d.changes).map((c, index) => <li key={index}>{index + 1}. {c.type === "machine_down" ? `Press down from ${readable(c.from_date)} for ${c.days} day(s)` : c.type === "extra_shift" ? `Extra ${c.kg} kg on ${readable(c.date)}`
        : c.type === "urgent_order" ? `Urgent order of ${c.kg} kg due ${readable(c.due_date)}` : `Receipt delayed ${c.days} day(s) for one job`}</li>)}</ol></Section>
      <Section title="Current plan against the scenario"><Table columns={["Job", "Order", "Kg", "Due", "Current plan finishes", "Scenario finishes", "Result"]} rows={list<Record<string, unknown>>(d.comparison).map(c => [`${c.job}${c.hypothetical ? " (hypothetical)" : ""}`, String(c.order), readable(c.kg), readable(c.due),
        c.simulated === false ? "Not simulated" : readable(c.baseline_finish ?? "Not in plan"), c.simulated === false ? "Not simulated" : readable(c.scenario_finish ?? "Beyond the horizon"),
        c.simulated === false ? "No recorded capacity for this press" : c.late === "true" ? "Late against the order date" : c.baseline_finish && c.scenario_finish && c.baseline_finish !== c.scenario_finish ? "Moves" : "Unchanged"])} /></Section>
      <Section title="Left out or not measured"><Table columns={["Press or job", "Why"]} rows={[...list<Record<string, unknown>>(d.machines).filter(m => !m.measured).map(m => [String(m.name), "No recorded shift capacity: its jobs are not simulated"]), ...list<Record<string, unknown>>(d.excluded).map(e => [String(e.number), String(e.reason)])]} /></Section></>;
  }

  return <div className="space-y-4">
    <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-2"><h2 className="break-words text-lg font-bold">{row.label}</h2><Badge value={row.status} /></div>
      <p className="text-sm font-semibold text-slate-700">{commercialStatusLabel(row.status, view)}</p><p className="break-words text-sm text-slate-600">{row.summary}</p>
      {row.source_href ? <Link href={row.source_href} className="inline-flex min-h-11 items-center text-sm font-bold underline">Open the source record</Link> : null}</section>
    {commands.length || open ? <section aria-label="Available actions" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"><h2 className="font-bold">Actions</h2>
      <div className="flex flex-wrap gap-2">{commands.map(command => <Button key={`${command.action}:${JSON.stringify(command.fixed ?? {})}`} type="button" variant={open?.action === command.action && open.label === command.label ? "primary" : "secondary"} onClick={() => setOpen(command)}>{command.label}</Button>)}</div>
      {open ? <div className="rounded-xl border border-slate-200 p-3"><CommercialMutationForm key={`${open.action}:${JSON.stringify(open.fixed ?? {})}`} action={open.action} role={context.role} fixed={open.fixed} initial={open.initial} title={open.label || COMMERCIAL_ACTION_FORMS[open.action].title} /></div> : null}</section> : null}
    {body}
    <p className="text-xs text-slate-500">Current authorized read as of {new Date(detail.as_of).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST. Figures are advisory; source workflows keep their own controls.</p>
  </div>;
}
