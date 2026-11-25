import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { CommandForm } from "@/components/modules/orchestration/delivery-closure-forms";
import { getSessionContext } from "@/lib/auth";
import { hasRouteAccess } from "@/lib/auth/route-permissions";
import { receivableFollowupAction } from "@/lib/actions/orchestration";
import { formatCurrency } from "@/lib/utils/format";
import { REASON_CATEGORIES, REASON_LABELS, SHIPMENT_STATE_LABELS, labelOf, receivableDetailSchema } from "@/lib/workflow/delivery-closure";

const at = (value: string | null | undefined) => (value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—");
const text = (v: string | null | undefined) => (v ? v.replace(/_/g, " ") : "—");
const reasonOptions = REASON_CATEGORIES.map(r => ({ value: r, label: REASON_LABELS[r] }));

// Phase 7 (finance only): one invoice's collection — payments, credit notes, the payment promise, disputes and write-offs.
export default async function PaymentFollowUpDetailPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const [{ invoiceId }, context] = await Promise.all([params, getSessionContext()]);
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) notFound();
  if (context.dealerId || !hasRouteAccess("/payments/follow-up", context.role)) redirect("/dashboard");
  const result = await receivableFollowupAction({ command: "get", invoice_id: invoiceId });
  const parsed = result.success ? receivableDetailSchema.safeParse(result.data) : null;
  if (!result.success || !parsed?.success) {
    return <div className="space-y-4"><PageHeader title="Payment follow-up" backHref="/payments/follow-up" backLabel="Back to payment follow-up" />
      <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : "The invoice could not be read."}</p></div>;
  }
  const d = parsed.data;
  const c = d.collectible;
  const open = d.invoice.status !== "cancelled" && (d.invoice.balance_due ?? 0) > 0;
  const complaintOptions = d.complaints.map(x => ({ value: x.id, label: `${x.complaint_number} · ${text(x.category)} · ${text(x.status)}` }));
  return (
    <div className="space-y-5">
      <PageHeader title={`${d.invoice.invoice_number ?? "Invoice"} · ${d.customer.name ?? "Customer"}`} backHref="/payments/follow-up" backLabel="Back to payment follow-up"
        description={`Invoice of ${d.invoice.invoice_date}, due ${d.invoice.due_date ?? "— (no due date recorded)"}${d.invoice.days_overdue ? ` · ${d.invoice.days_overdue} day(s) overdue` : ""} · ${text(d.invoice.status)}`}
        actions={<div className="flex flex-wrap gap-2"><Link href={`/invoices/${invoiceId}`} className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Invoice</Link>
          <Link href="/payments/new" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Record a payment</Link>
          {d.order ? <Link href={`/orders/closure/${d.order.id}`} className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Order closure</Link> : null}</div>} />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[["Invoice total", formatCurrency(d.invoice.grand_total)], ["Paid", formatCurrency(d.invoice.amount_paid)], ["Credited", formatCurrency(d.invoice.credited_amount)],
          ["Written off (approved)", formatCurrency(c.written_off)], ["Collectible", formatCurrency(c.collectible)]].map(([k, v]) =>
          <div key={k} className="rounded-2xl border border-slate-200 bg-white p-3"><p className="text-xs font-bold uppercase text-slate-500">{k}</p><p className="text-lg font-bold">{v}</p></div>)}
      </section>
      {c.disputed || c.pending_write_off ? <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
        {c.disputed ? `${formatCurrency(c.disputed)} disputed by the customer. ` : ""}{c.pending_write_off ? `${formatCurrency(c.pending_write_off)} proposed for write-off, awaiting decision.` : ""} The order stays financially open until these are resolved.</p> : null}
      <p className="text-sm text-slate-600">Delivery: {d.dispatch ? <><Link className="font-semibold underline" href={`/dispatches/deliveries/${d.dispatch.id}`}>{d.dispatch.dispatch_number}</Link> · {labelOf(SHIPMENT_STATE_LABELS, d.dispatch.shipment_state)}</> : "the invoice is not linked to a dispatch"}
        {d.promise ? ` · Payment promise: ${formatCurrency(d.promise.amount)} by ${d.promise.due_date} (${d.promise.employee ?? "—"})` : ""}{d.task ? ` · Follow-up task ${d.task.status}${d.task.escalation_level ? `, escalated ${d.task.escalation_level}` : ""}` : ""}</p>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          {open ? <CommandForm area="receivable" command="dispute.open" fixed={{ invoice_id: invoiceId }} withId collapsed title="Record a customer dispute" submitLabel="Record dispute" done="Dispute recorded."
            help="A dispute does not reduce what is collectible; it keeps the order financially open until resolved."
            fields={[{ name: "amount", label: "Disputed amount (₹)", type: "number", required: true, min: 0.01, step: "0.01" }, { name: "reason_category", label: "Reason", type: "select", required: true, options: reasonOptions },
              { name: "customer_reference", label: "Customer reference (debit note, letter)", type: "text", maxLength: 120 },
              ...(complaintOptions.length ? [{ name: "complaint_id", label: "Related complaint", type: "select" as const, options: complaintOptions }] : []),
              { name: "reason", label: "Explanation", type: "textarea", required: true, minLength: 10, maxLength: 500 }]} /> : null}
          {open ? <CommandForm area="receivable" command="write_off.propose" fixed={{ invoice_id: invoiceId }} withId collapsed title="Propose a write-off" submitLabel="Propose write-off" done="Write-off proposed; the approver is asked to decide."
            help="Approved under the write-off rule of the authority matrix when one is configured, else by the owner or an admin — never by the proposer. Post the approved write-off in the books of account."
            fields={[{ name: "amount", label: "Amount (₹)", type: "number", required: true, min: 0.01, step: "0.01" }, { name: "reason_category", label: "Reason", type: "select", required: true, options: reasonOptions },
              { name: "customer_reference", label: "Customer reference", type: "text", maxLength: 120 },
              ...(complaintOptions.length ? [{ name: "complaint_id", label: "Related complaint", type: "select" as const, options: complaintOptions }] : []),
              { name: "reason", label: "Explanation", type: "textarea", required: true, minLength: 10, maxLength: 500 }]} /> : null}
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-bold">Payments and credit notes</h2>
            {d.payments.length || d.credit_notes.length ? <ul className="mt-2 divide-y text-sm">
              {d.payments.map(p => <li key={p.id} className={`py-2 ${p.reversed ? "text-slate-500 line-through" : ""}`}>{p.payment_date} · {formatCurrency(p.amount)} · {text(p.method)}{p.reference ? ` · ${p.reference}` : ""}</li>)}
              {d.credit_notes.map(n => <li key={n.id} className="py-2">Credit note {n.credit_note_number} · {n.credit_date} · {formatCurrency(n.grand_total)} · {n.status} — {n.reason}</li>)}
            </ul> : <p className="mt-1 text-sm">None recorded.</p>}
          </section>
        </div>
        <section className="space-y-3">
          <h2 className="text-lg font-bold">Disputes and write-offs</h2>
          {d.exceptions.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">None recorded.</p> : d.exceptions.map(e => (
            <article key={e.id} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
              <p className="font-bold">{e.kind === "dispute" ? "Dispute" : "Write-off"} · {formatCurrency(e.amount)} · {text(e.status)}{e.outcome ? ` (${text(e.outcome)})` : ""}</p>
              <p>{REASON_LABELS[e.reason_category]} — {e.reason}{e.customer_reference ? ` · ref ${e.customer_reference}` : ""}{e.complaint_number ? ` · complaint ${e.complaint_number}` : ""}</p>
              <p className="text-xs text-slate-500">Raised by {e.raised_by_name ?? "—"}, {at(e.raised_at)}{e.first_approved_by_name ? ` · first approval ${e.first_approved_by_name}` : ""}{e.decided_by_name ? ` · decided by ${e.decided_by_name}, ${at(e.decided_at)}: ${e.decision_note}` : ""}</p>
              <div className="flex flex-wrap gap-2">
                {e.can_decide ? <CommandForm area="receivable" command="write_off.decide" fixed={{ id: e.id }} collapsed title="Decide the write-off" submitLabel="Record decision" done="Decision recorded."
                  fields={[{ name: "decision", label: "Decision", type: "select", required: true, options: [{ value: "approve", label: "Approve" }, { value: "reject", label: "Reject" }] },
                    { name: "note", label: "Reason", type: "textarea", required: true, minLength: 10, maxLength: 500 }]} /> : null}
                {e.can_resolve ? <CommandForm area="receivable" command="dispute.resolve" fixed={{ id: e.id }} collapsed title="Resolve the dispute" submitLabel="Resolve" done="Dispute resolved."
                  help="If the amount was conceded, issue the credit note or have the write-off approved first."
                  fields={[{ name: "outcome", label: "Outcome", type: "select", required: true, options: [{ value: "customer_to_pay", label: "Customer pays" }, { value: "credit_note", label: "Credit note issued" }, { value: "written_off", label: "Written off under authority" }] },
                    { name: "note", label: "How it ended", type: "textarea", required: true, minLength: 10, maxLength: 500 }]} /> : null}
                {e.can_withdraw ? <CommandForm area="receivable" command="exception.withdraw" fixed={{ id: e.id }} collapsed danger title="Withdraw" submitLabel="Withdraw" done="Withdrawn."
                  fields={[{ name: "note", label: "Why it is withdrawn", type: "textarea", required: true, minLength: 10, maxLength: 500 }]} /> : null}
              </div>
            </article>))}
        </section>
      </section>
    </div>
  );
}
