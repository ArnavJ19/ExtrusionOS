"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ReceiptIndianRupee } from "lucide-react";
import { toast } from "sonner";
import { recordPaymentAction, searchOpenInvoicesAction } from "@/lib/actions/payments";
import { nextIdempotentAttempt } from "@/lib/financials/expenses";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import type { SessionContext } from "@/types/app";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading";
import { SearchableSelect } from "@/components/ui/searchable-select";

type OpenInvoice = {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  due_date: string | null;
  grand_total: number;
  amount_paid: number;
  credited_amount?: number;
  balance_due: number;
  status: string;
  customer_name?: string | null;
  order_number?: string | null;
  customers?: { customer_name?: string | null; company_name?: string | null } | null;
  orders?: { order_number?: string | null } | null;
};

function relation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function invoiceCustomer(invoice: OpenInvoice) {
  const customer = relation(invoice.customers);
  return invoice.customer_name || customer?.company_name || customer?.customer_name || "Unknown customer";
}

function invoiceOrder(invoice: OpenInvoice | null) {
  return invoice?.order_number ?? relation(invoice?.orders)?.order_number ?? "-";
}

export function PaymentFormClient({
  context,
  initialInvoiceId = "",
  today
}: {
  context: SessionContext;
  initialInvoiceId?: string;
  today?: string;
}) {
  const router = useRouter();
  // Receipt dates follow the Asia/Kolkata business calendar used by the database (AR-10).
  const businessToday = useMemo(() => today ?? getBusinessDateBoundaries().today, [today]);
  const attempt = useRef<{ requestKey: string; idempotencyKey: string } | null>(null);
  const [invoices, setInvoices] = useState<OpenInvoice[]>([]);
  const [invoiceId, setInvoiceId] = useState(initialInvoiceId);
  const [paymentDate, setPaymentDate] = useState(businessToday);
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [searching, setSearching] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const searchVersion = useRef(0);
  const isCreditAdjustment = paymentMethod === "credit_note";

  // Open invoices are searched on the server, 25 at a time. A deep-linked invoice is resolved
  // by ID so it never depends on the first page of results (AR-08).
  async function searchInvoices(term: string, selectedId: string | null = null) {
    const version = ++searchVersion.current;
    setSearching(true);
    const result = await searchOpenInvoicesAction({ search: term, selectedId });
    if (version !== searchVersion.current) return null;
    setSearching(false);
    if (!result.success) throw new Error(result.error);
    if (!selectedId) setHasMore(result.data.hasMore);
    setInvoices((current) => {
      const merged = new Map(current.filter((row) => row.id === invoiceId || row.id === selectedId).map((row) => [row.id, row]));
      for (const row of result.data.rows) merged.set(row.id, row);
      return Array.from(merged.values());
    });
    return result.data.rows;
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (initialInvoiceId) {
        const rows = await searchInvoices("", initialInvoiceId);
        const initial = rows?.find((invoice) => invoice.id === initialInvoiceId);
        if (!cancelled && initial) setAmount(String(initial.balance_due));
      }
      await searchInvoices("");
    }
    load()
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load open invoices");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [context.companyId, initialInvoiceId]);

  const selectedInvoice = invoices.find((invoice) => invoice.id === invoiceId) ?? null;
  const options = invoices.map((invoice) => ({
    value: invoice.id,
    label: `${invoice.invoice_number || "Draft invoice"} - ${invoiceCustomer(invoice)} - balance ${formatCurrency(invoice.balance_due)}`
  }));

  function selectInvoice(value: string) {
    const invoice = invoices.find((item) => item.id === value);
    setInvoiceId(value);
    setAmount(invoice ? String(invoice.balance_due) : "");
  }

  function submit() {
    const payload = {
      invoice_id: invoiceId,
      payment_date: paymentDate,
      amount: Number(amount),
      payment_method: paymentMethod as "bank_transfer" | "upi" | "cheque" | "cash" | "credit_note" | "other",
      reference_number: referenceNumber,
      notes
    };
    // The same key is reused only for an unchanged retry. Editing any detail starts a new key,
    // and the database rejects a reused key whose details differ (AR-03).
    attempt.current = nextIdempotentAttempt(attempt.current, JSON.stringify([payload.invoice_id, payload.payment_date,
      Number(payload.amount).toFixed(2), payload.payment_method, payload.reference_number.trim(), payload.notes.trim()]),
      () => crypto.randomUUID());
    const idempotencyKey = attempt.current.idempotencyKey;
    startTransition(async () => {
      const result = await recordPaymentAction({ ...payload, idempotency_key: idempotencyKey });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`${isCreditAdjustment ? "Credit adjustment" : "Receipt"} posted. Invoice balance is ${formatCurrency(result.data.balance_due)}.`);
      router.push(`/payments/${result.data.payment_id}`);
      router.refresh();
    });
  }

  if (loading) return <LoadingState title="Loading open invoices" description="Checking current balances and customer lineage." />;
  if (error) return <ErrorState description={error} onRetry={() => window.location.reload()} />;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/payments" className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-neutral-500 hover:text-neutral-950">
          <ArrowLeft className="h-4 w-4" /> Back to payments
        </Link>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700"><ReceiptIndianRupee className="h-6 w-6" /></div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-neutral-950">{isCreditAdjustment ? "Record Credit Adjustment" : "Record Customer Receipt"}</h1>
            <p className="mt-1 text-sm font-medium text-neutral-500">{isCreditAdjustment ? "Record a non-cash reduction against one invoice. For a returned or damaged dispatch, use its return credit note." : "Select the receivable first. The server will validate the locked balance and close or part-pay the invoice."}</p>
          </div>
        </div>
      </div>

      {invoices.length === 0 && !searching ? (
        <Card>
          <CardContent className="py-10 text-center">
            <h2 className="text-lg font-bold text-neutral-950">No issued invoice has an open balance</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm font-medium leading-6 text-neutral-500">Create or generate an invoice from an order or dispatch before recording a receipt.</p>
            <Link href="/invoices/new" className="mt-5 inline-flex rounded-2xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white">Create Invoice</Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card>
            <CardHeader><h2 className="section-title">{isCreditAdjustment ? "Adjustment Details" : "Receipt Details"}</h2></CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-2">
              <label className="block space-y-1.5 md:col-span-2">
                <span className="form-label">Invoice *</span>
                <SearchableSelect value={invoiceId} options={options} placeholder="Search invoice number or customer" onChange={selectInvoice}
                  onSearchChange={(query) => { void searchInvoices(query).catch((searchError) => toast.error(searchError instanceof Error ? searchError.message : "Search failed")); }}
                  searching={searching} />
                {hasMore ? <span className="form-hint">Showing the first 25 matches. Type an invoice number or customer to narrow the list.</span> : null}
              </label>
              <label className="block space-y-1.5">
                <span className="form-label">Payment date *</span>
                <input className="form-input" type="date" max={businessToday} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
              </label>
              <label className="block space-y-1.5">
                <span className="form-label">{isCreditAdjustment ? "Adjustment amount" : "Amount received"} *</span>
                <input className="form-input" type="number" min="0.01" step="0.01" max={selectedInvoice?.balance_due} value={amount} onChange={(event) => setAmount(event.target.value)} />
              </label>
              <label className="block space-y-1.5">
                <span className="form-label">Payment method *</span>
                <select className="form-input" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="upi">UPI</option>
                  <option value="cheque">Cheque</option>
                  <option value="cash">Cash</option>
                  <option value="credit_note">Credit adjustment (non-cash)</option>
                  <option value="other">Other</option>
                </select>
                {isCreditAdjustment ? <p className="form-hint">Use a standalone adjustment only when this invoice has no issued return credit note. For a returned or damaged dispatch, issue its credit note from the dispatch record instead. A partial shortage or damage on a delivered dispatch is settled with this adjustment.</p> : null}
              </label>
              <label className="block space-y-1.5">
                <span className="form-label">Reference number{["bank_transfer", "upi", "cheque"].includes(paymentMethod) ? " *" : ""}</span>
                <input className="form-input" value={referenceNumber} placeholder="UTR, UPI reference, or cheque number" onChange={(event) => setReferenceNumber(event.target.value)} />
              </label>
              <label className="block space-y-1.5 md:col-span-2">
                <span className="form-label">Notes</span>
                <textarea className="form-input min-h-28" value={notes} placeholder="Bank, branch, payer, or reconciliation note" onChange={(event) => setNotes(event.target.value)} />
              </label>
              <div className="flex flex-wrap gap-3 md:col-span-2">
                <Button type="button" disabled={isPending || !selectedInvoice || Number(amount) <= 0} onClick={submit}>{isPending ? "Posting..." : isCreditAdjustment ? "Post Credit Adjustment" : "Post Receipt"}</Button>
                <Link href="/payments" className="inline-flex items-center rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700">Cancel</Link>
              </div>
            </CardContent>
          </Card>

          <Card className="h-fit xl:sticky xl:top-24">
            <CardHeader><h2 className="section-title">Receivable Check</h2></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <Summary label="Customer" value={selectedInvoice ? invoiceCustomer(selectedInvoice) : "Select an invoice"} />
              <Summary label="Invoice" value={selectedInvoice?.invoice_number ?? "-"} />
              <Summary label="Order" value={invoiceOrder(selectedInvoice)} />
              <Summary label="Invoice date" value={selectedInvoice ? formatDate(selectedInvoice.invoice_date) : "-"} />
              <Summary label="Due date" value={selectedInvoice ? formatDate(selectedInvoice.due_date) : "-"} />
              <Summary label="Invoice total" value={selectedInvoice ? formatCurrency(selectedInvoice.grand_total) : "-"} />
              <Summary label="Receipts and adjustments" value={selectedInvoice ? formatCurrency(selectedInvoice.amount_paid) : "-"} />
              <Summary label="Return credit notes" value={selectedInvoice ? formatCurrency(selectedInvoice.credited_amount ?? 0) : "-"} />
              <div className="rounded-2xl bg-neutral-950 p-4 text-white"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-300">Outstanding balance</p><p className="mt-2 text-2xl font-bold">{selectedInvoice ? formatCurrency(selectedInvoice.balance_due) : "-"}</p></div>
              <p className="text-xs font-semibold leading-5 text-neutral-500">Credit notes settle the invoice but are excluded from cash-collection analytics.</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4 border-b border-neutral-100 pb-3"><span className="font-medium text-neutral-500">{label}</span><span className="text-right font-bold text-neutral-950">{value}</span></div>;
}
