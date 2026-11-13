// AP-089: WhatsApp-ready summaries. The database returns the facts for one record (private.ap4_summary), already cut
// to the customer-safe or internal set for the caller's role; this module only formats them. Neither version contains
// cost, margin, supplier or freight rates.

export const SUMMARY_KINDS = ["order", "dispatch", "invoice", "job", "quote"] as const;
export type SummaryKind = (typeof SUMMARY_KINDS)[number];
export type SummaryAudience = "customer" | "internal";
export type SummaryFacts = { kind: SummaryKind; audience: SummaryAudience; facts: Record<string, any>; phone?: string | null };

const kg = (value: unknown) => (value === null || value === undefined || value === "" ? null : `${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`);
const inr = (value: unknown) => (value === null || value === undefined || value === "" ? null : `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const day = (value: unknown) => (typeof value === "string" && value
  ? new Date(value.length === 10 ? `${value}T00:00:00+05:30` : value).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : null);
const line = (label: string, value: string | number | null | undefined) => (value === null || value === undefined || value === "" ? null : `${label}: ${value}`);
const join = (lines: (string | null | undefined)[]) => lines.filter((x): x is string => Boolean(x)).join("\n");

function orderSummary(f: Record<string, any>, internal: boolean) {
  const lines = (f.lines ?? []) as Record<string, any>[];
  const ordered = lines.reduce((s, l) => s + Number(l.ordered_kg ?? 0), 0), shipped = lines.reduce((s, l) => s + Number(l.dispatched_kg ?? 0), 0);
  const dispatches = (f.dispatches ?? []) as Record<string, any>[];
  return join([
    `*Order ${f.order_number}*${f.company ? ` — ${f.company}` : ""}`,
    line("Customer", f.customer), line("Ordered on", day(f.order_date)), line("Status", f.stage), line("Expected dispatch", day(f.expected_dispatch_date)),
    ...lines.map(l => `• ${l.profile || "Profile"}${l.finish ? ` (${l.finish})` : ""}: ${l.ordered_pieces ? `${l.ordered_pieces} pcs / ` : ""}${kg(l.ordered_kg) ?? "—"} — dispatched ${kg(l.dispatched_kg) ?? "0 kg"}`),
    ordered > 0 ? `Dispatched so far: ${kg(shipped)} of ${kg(ordered)}` : null,
    ...dispatches.slice(-3).map(d => `Vehicle ${d.vehicle ?? "—"}${d.lr_number ? `, LR ${d.lr_number}` : ""} on ${day(d.date) ?? "—"} (${d.status})`),
    internal ? line("Credit", f.credit && f.credit !== "none" ? String(f.credit).replace("_", " ") : null) : null,
    internal ? line("Open production jobs", f.jobs_open) : null, internal ? line("Bundles waiting to load", f.bundles_waiting) : null,
    internal ? line("Priority", f.priority) : null, internal ? line("Note", f.notes) : null
  ]);
}

function dispatchSummary(f: Record<string, any>, internal: boolean) {
  return join([
    `*Dispatch ${f.number ?? ""}*`, line("Order", f.order_number), line("Customer", f.customer), line("Date", day(f.date)),
    line("Bundles", f.bundles), line("Net weight", kg(f.net_kg)), line("Vehicle", f.vehicle), line("Transporter", f.transporter), line("LR number", f.lr_number),
    line("Driver", [f.driver, f.driver_phone].filter(Boolean).join(", ") || null), line("E-way bill", f.eway_bill_number), line("Status", f.status),
    internal ? line("Invoice", f.invoice_number) : null, internal ? line("Left the gate", f.gate_out ? day(f.gate_out) : "not yet") : null, internal ? line("Remarks", f.remarks) : null
  ]);
}

function invoiceSummary(f: Record<string, any>, internal: boolean) {
  return join([
    `*Invoice ${f.number ?? ""}*`, line("Customer", f.customer), line("Date", day(f.date)), line("Due", day(f.due_date)), line("Order", f.order_number), line("Dispatch", f.dispatch_number),
    line("Amount", inr(f.total)), Number(f.paid) > 0 ? line("Received", inr(f.paid)) : null, line("Balance", inr(f.balance)), line("Status", f.status),
    internal ? line("Overdue by", f.overdue_days ? `${f.overdue_days} day(s)` : null) : null, internal ? line("Note", f.notes) : null
  ]);
}

function jobSummary(f: Record<string, any>, internal: boolean) {
  return join([
    `*Production ${f.number ?? ""}*`, line("Order", f.order_number), line("Customer", f.customer), line("Profile", f.profile), line("Planned", kg(f.planned_kg)),
    line("Produced", kg(f.actual_kg)), line("Status", f.status), line("Planned date", day(f.planned_date)),
    internal ? line("Press", f.press) : null, internal ? line("Die", f.die) : null, internal ? line("Shift", f.shift) : null, internal ? line("Remarks", f.remarks) : null
  ]);
}

function quoteSummary(f: Record<string, any>, internal: boolean) {
  return join([
    `*Quotation ${f.number ?? ""}${Number(f.revision) > 1 ? ` (rev ${f.revision})` : ""}*`, line("Customer", f.customer), line("Date", day(f.date)), line("Valid until", day(f.valid_until)),
    line("Items", f.items), line("Value before GST", inr(f.total_before_gst)), line("GST", inr(f.gst)), line("Total", inr(f.total)), line("Delivery", f.delivery), line("Payment terms", f.payment_terms),
    internal ? line("Status", f.status) : null, internal && f.approval_needed ? "Needs approval before sending." : null, internal ? line("Note", f.notes) : null
  ]);
}

export function formatRecordSummary(input: SummaryFacts): string {
  const internal = input.audience === "internal";
  const body = input.kind === "order" ? orderSummary(input.facts, internal) : input.kind === "dispatch" ? dispatchSummary(input.facts, internal)
    : input.kind === "invoice" ? invoiceSummary(input.facts, internal) : input.kind === "job" ? jobSummary(input.facts, internal) : quoteSummary(input.facts, internal);
  return internal ? `${body}\n_Internal — do not forward to the customer._` : body;
}
