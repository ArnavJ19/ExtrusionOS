import { RecordFollow } from "@/components/modules/notifications/record-follow";
import { canFollow } from "@/lib/workflow/subscriptions";
import Link from "next/link";
import { CustomerRefundForm } from "@/components/modules/financials/customer-refund-form";
import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { reconcileInvoiceSettlement } from "@/lib/financials/receivables";
import { createClient } from "@/lib/supabase/server";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { redirect } from "next/navigation";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "read", "financials")) redirect("/dashboard");
  return (
    <div id="receipt-history" className="space-y-6">
      <RecordDetailClient moduleKey="invoices" context={context} recordId={id} canEdit={can(context.role, "update", "financials")} />
      {!context.dealerId && canFollow(context.role, "invoice") ? <RecordFollow entityType="invoice" entityId={id} /> : null}
      <InvoiceSettlementPanel invoiceId={id} canManage={can(context.role, "create", "financials")} />
    </div>
  );
}

// Shows every transaction that moves the receivable so the displayed balance reconciles (RPT-06).
async function InvoiceSettlementPanel({ invoiceId, canManage }: { invoiceId: string; canManage: boolean }) {
  const context = await getSessionContext();
  const supabase = await createClient();
  const [invoice, payments, creditNotes] = await Promise.all([
    supabase.from("invoices").select("id, grand_total, amount_paid, credited_amount, balance_due, customer_credit_due, status")
      .eq("company_id", context.companyId).eq("id", invoiceId).maybeSingle(),
    supabase.from("payments").select("id, payment_date, amount, payment_method, payment_type, payment_status, reference_number")
      .eq("company_id", context.companyId).eq("invoice_id", invoiceId).order("payment_date", { ascending: false }).limit(200),
    supabase.from("credit_notes").select("id, credit_note_number, credit_date, grand_total, status, reason, dispatch_id")
      .eq("company_id", context.companyId).eq("invoice_id", invoiceId).order("created_at", { ascending: false }).limit(50)
  ]);
  if (invoice.error || payments.error || creditNotes.error || !invoice.data) {
    return <Card><CardContent className="py-6 text-sm font-semibold text-amber-800">Receipt and credit-note history is unavailable. The balance cannot be reconciled until it loads.</CardContent></Card>;
  }
  const reconciliation = reconcileInvoiceSettlement(invoice.data, payments.data ?? [], creditNotes.data ?? []);
  const issuedCredit = (creditNotes.data ?? []).find((note) => note.status === "issued") ?? null;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="section-title">Receivable Reconciliation</h2><p className="mt-1 text-sm font-medium text-slate-500">Invoice total less net receipts and return credit notes equals the balance. Refunds paid back to the customer reduce net receipts.</p></div>
          <Link href={`/payments/new?invoice_id=${invoiceId}`} className="inline-flex rounded-2xl border border-neutral-200 px-4 py-2.5 text-sm font-semibold">Record receipt</Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 rounded-2xl bg-slate-950 p-4 text-white sm:grid-cols-3 xl:grid-cols-6">
          <Metric label="Invoice total" value={formatCurrency(reconciliation.total)} />
          <Metric label="Cash receipts" value={formatCurrency(reconciliation.cashReceipts)} />
          <Metric label="Credit adjustments" value={formatCurrency(reconciliation.adjustments)} />
          <Metric label="Refunds paid" value={formatCurrency(reconciliation.refunds)} />
          <Metric label="Return credit notes" value={formatCurrency(reconciliation.creditNotes)} />
          <Metric label="Balance due" value={formatCurrency(reconciliation.balance)} />
        </div>
        {!reconciliation.matchesStoredBalance ? <p role="alert" className="text-sm font-bold text-rose-700">The stored balance ({formatCurrency(invoice.data.balance_due)}) does not match the posted history. Review this invoice in the settlement review before taking further receipts.</p> : null}
        {canManage ? <CustomerRefundForm invoiceId={invoiceId} creditDue={Number(invoice.data.customer_credit_due ?? 0)} creditNoteId={issuedCredit?.id ?? null} today={getBusinessDateBoundaries().today} /> : null}
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="industrial-table min-w-[760px]">
            <thead><tr><th>Date</th><th>Entry</th><th>Reference</th><th>Status</th><th className="text-right">Effect on balance</th></tr></thead>
            <tbody>
              {reconciliation.entries.map((entry) => (
                <tr key={`${entry.kind}-${entry.id}`}>
                  <td>{formatDate(entry.date)}</td>
                  <td>{entry.href ? <Link className="font-semibold text-slate-900 underline" href={entry.href}>{entry.label}</Link> : entry.label}</td>
                  <td>{entry.reference ?? "-"}{entry.pdfHref ? <a className="ml-2 text-xs font-semibold text-slate-600 underline" href={entry.pdfHref} target="_blank" rel="noreferrer">PDF</a> : null}</td>
                  <td><Badge value={entry.status} /></td>
                  <td className="text-right font-semibold tabular-nums">{entry.effective ? formatCurrency(entry.balanceEffect) : "Not counted"}</td>
                </tr>
              ))}
              {!reconciliation.entries.length ? <tr><td colSpan={5} className="py-8 text-center font-semibold text-slate-500">No receipts, refunds or credit notes posted.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[11px] font-black uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 text-base font-black">{value}</p></div>;
}
